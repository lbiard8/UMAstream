//! Windows : son par application avec le "process loopback" de WASAPI (Windows 11, ou Windows 10
//! build 20348+ ; sur un Windows plus ancien, `capture` échoue), et fenêtres réduites.

use std::collections::{BTreeMap, VecDeque};

use sysinfo::Pid;
use wasapi::{
    AudioClient, DeviceEnumerator, Direction, SampleType, SessionState, StreamMode, WaveFormat,
    initialize_mta,
};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_EXSTYLE, GetWindow, GetWindowLongW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SW_SHOWNOACTIVATE, ShowWindow,
    WS_EX_TOOLWINDOW,
};
use windows::core::BOOL;

use crate::Platform;
use crate::common::{
    AudioApp, CHANNELS, MinimizedWindow, PcmWriter, Result, SAMPLE_RATE, process_list, process_name,
    root_process, same_name,
};

pub struct WindowsPlatform;

impl Platform for WindowsPlatform {
    /// Les applications qui ont une session audio sur une sortie (haut-parleurs, casque…).
    fn list_audio_apps(&self) -> Result<Vec<AudioApp>> {
        initialize_mta().ok()?;
        let system = process_list();

        // pid racine -> (exe, active ?). Une appli peut avoir plusieurs sessions (une par sortie audio).
        let mut apps: BTreeMap<u32, (String, bool)> = BTreeMap::new();
        let enumerator = DeviceEnumerator::new()?;
        for device in &enumerator.get_device_collection(Direction::Render)? {
            let Ok(device) = device else { continue };
            let Ok(manager) = device.get_iaudiosessionmanager() else { continue };
            let Ok(sessions) = manager.get_audiosessionenumerator() else { continue };
            for i in 0..sessions.get_count()? {
                let Ok(session) = sessions.get_session(i) else { continue };
                let state = session.get_state()?;
                if state == SessionState::Expired {
                    continue; // session terminée
                }
                let pid = session.get_process_id()?;
                if pid == 0 {
                    continue; // "Sons système" de Windows : pas une application
                }
                let root = root_process(&system, pid, same_name);
                let exe = process_name(&system, root);
                // Pour capturer, ce programme ouvre lui-même une session audio : on ne se liste pas soi-même
                if exe.eq_ignore_ascii_case("umastream-audio.exe") {
                    continue;
                }
                let entry = apps.entry(root).or_insert((exe, false));
                entry.1 |= state == SessionState::Active;
            }
        }
        Ok(apps.into_iter().map(|(pid, (exe, active))| AudioApp { pid, exe, active }).collect())
    }

    fn capture(&self, pid: u32, out: &mut PcmWriter) -> Result<()> {
        initialize_mta().ok()?;

        // 48 kHz stéréo en flottant 32 bits : le format qu'utilise directement le navigateur (Web Audio).
        // autoconvert : Windows convertit lui-même si l'application joue dans un autre format.
        let format = WaveFormat::new(32, 32, SampleType::Float, SAMPLE_RATE as usize, CHANNELS, None);
        // true = include_tree : l'application ET ses sous-processus
        let mut client = AudioClient::new_application_loopback_client(pid, true)?;
        let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
        client.initialize_client(&format, Direction::Capture, mode, None)?;
        let event = client.set_get_eventhandle()?;
        let capture_client = client.get_audiocaptureclient()?;
        client.start_stream()?;

        let mut queue: VecDeque<u8> = VecDeque::new();
        loop {
            // Une appli silencieuse ne produit aucun paquet : l'attente expire, on recommence simplement.
            let _ = event.wait_for_event(500);
            while capture_client.get_next_packet_size()?.unwrap_or(0) > 0 {
                capture_client.read_from_device_to_deque(&mut queue)?;
            }
            if queue.is_empty() {
                continue;
            }
            let (a, b) = queue.as_slices();
            if out.write_bytes(&[a, b]).is_err() {
                let _ = client.stop_stream();
                return Ok(());
            }
            queue.clear();
        }
    }

    /// Les fenêtres réduites "normales" (celles de la barre des tâches). Windows ne sait pas capturer
    /// une fenêtre réduite : Electron ne les propose donc pas, et l'appli les ajoute grâce à cette liste.
    fn list_minimized_windows(&self) -> Result<Vec<MinimizedWindow>> {
        // EnumWindows appelle `collect` une fois par fenêtre ; on lui passe notre liste via le LPARAM
        unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let found = unsafe { &mut *(lparam.0 as *mut Vec<(isize, String, u32)>) };
            unsafe {
                // Visible, réduite, sans fenêtre "propriétaire" (pas une boîte de dialogue)
                if !IsWindowVisible(hwnd).as_bool() || !IsIconic(hwnd).as_bool() {
                    return BOOL(1);
                }
                if GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.0.is_null()) {
                    return BOOL(1);
                }
                // Pas une petite fenêtre d'outil (palettes, fenêtres invisibles de certaines applis)
                if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
                    return BOOL(1);
                }
                // Pas une fenêtre "masquée" par Windows (applis du Store en arrière-plan, autres bureaux…)
                let mut cloaked: u32 = 0;
                let _ = DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_CLOAKED,
                    &mut cloaked as *mut u32 as *mut _,
                    std::mem::size_of::<u32>() as u32,
                );
                if cloaked != 0 {
                    return BOOL(1);
                }
                let mut buffer = [0u16; 512];
                let len = GetWindowTextW(hwnd, &mut buffer);
                if len <= 0 {
                    return BOOL(1); // sans titre : rien à montrer à l'utilisateur
                }
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                found.push((hwnd.0 as isize, String::from_utf16_lossy(&buffer[..len as usize]), pid));
            }
            BOOL(1) // continuer l'énumération
        }

        let mut found: Vec<(isize, String, u32)> = Vec::new();
        unsafe { EnumWindows(Some(collect), LPARAM(&mut found as *mut _ as isize))? };

        // Le programme de chaque fenêtre (son chemin sert à afficher son icône dans la fenêtre de choix)
        let system = process_list();
        Ok(found
            .into_iter()
            .map(|(hwnd, title, pid)| {
                let process = system.process(Pid::from_u32(pid));
                MinimizedWindow {
                    hwnd,
                    title,
                    exe: process.map(|p| p.name().to_string_lossy().into_owned()).unwrap_or_default(),
                    path: process.and_then(|p| p.exe()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
                }
            })
            .collect())
    }

    fn restore_window(&self, handle: isize) -> Result<()> {
        // SW_SHOWNOACTIVATE : la fenêtre retrouve sa taille, sans passer devant l'appli UMAstream
        unsafe {
            let _ = ShowWindow(HWND(handle as *mut _), SW_SHOWNOACTIVATE);
        }
        Ok(())
    }
}
