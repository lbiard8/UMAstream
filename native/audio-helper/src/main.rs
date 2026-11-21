//! umastream-audio : petit programme lancé par l'application UMAstream (Electron).
//!
//! Il fait deux choses, que le navigateur ne sait pas faire :
//!
//!   umastream-audio list
//!       Affiche en JSON les applications qui ont une session audio (comme le mélangeur de volume
//!       de Windows) : [{"pid": 1234, "exe": "Discord.exe", "active": true}, ...]
//!
//!   umastream-audio capture <pid>
//!       Capture le son de CETTE application seulement (et de ses sous-processus), et l'écrit en
//!       continu sur la sortie standard : échantillons flottants 32 bits, 48 000 Hz, stéréo,
//!       entrelacés (gauche, droite, gauche, droite…). S'arrête quand l'appli UMAstream ferme le tuyau.
//!
//!   umastream-audio windows
//!       Affiche en JSON les fenêtres RÉDUITES dans la barre des tâches. Windows ne sait pas capturer
//!       une fenêtre réduite : Electron ne les propose donc pas, et l'appli les ajoute grâce à cette liste.
//!       [{"hwnd": 66686, "title": "…", "exe": "Code.exe", "path": "C:\\…\\Code.exe"}, ...]
//!
//!   umastream-audio restore <hwnd>
//!       Rouvre une fenêtre réduite, SANS lui donner le focus (l'appli UMAstream reste au premier plan).
//!
//! La capture par application utilise le "process loopback" de Windows (Windows 11, ou Windows 10
//! build 20348+). Sur un Windows trop ancien, `capture` échoue avec le code de sortie 2.

use std::collections::{BTreeMap, VecDeque};
use std::io::{self, Write};
use std::process::ExitCode;

use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System, UpdateKind};
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

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("list") => match list_audio_apps() {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("Erreur lors de la liste des applications : {err}");
                ExitCode::from(1)
            }
        },
        Some("capture") => {
            let Some(pid) = args.get(2).and_then(|p| p.parse::<u32>().ok()) else {
                eprintln!("Usage : umastream-audio capture <pid>");
                return ExitCode::from(1);
            };
            match capture(pid) {
                Ok(()) => ExitCode::SUCCESS,
                Err(err) => {
                    eprintln!("Capture impossible pour le processus {pid} : {err}");
                    ExitCode::from(2)
                }
            }
        }
        Some("windows") => match list_minimized_windows() {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("Erreur lors de la liste des fenêtres : {err}");
                ExitCode::from(1)
            }
        },
        Some("restore") => {
            let Some(hwnd) = args.get(2).and_then(|h| h.parse::<isize>().ok()) else {
                eprintln!("Usage : umastream-audio restore <hwnd>");
                return ExitCode::from(1);
            };
            // SW_SHOWNOACTIVATE : la fenêtre retrouve sa taille, sans passer devant l'appli UMAstream
            unsafe {
                let _ = ShowWindow(HWND(hwnd as *mut _), SW_SHOWNOACTIVATE);
            }
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("Usage : umastream-audio list | capture <pid> | windows | restore <hwnd>");
            ExitCode::from(1)
        }
    }
}

/// Liste les fenêtres réduites "normales" (celles de la barre des tâches) en JSON.
fn list_minimized_windows() -> Result<(), Box<dyn std::error::Error>> {
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
    let system = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet)),
    );
    let list: Vec<serde_json::Value> = found
        .into_iter()
        .map(|(hwnd, title, pid)| {
            let process = system.process(Pid::from_u32(pid));
            serde_json::json!({
                "hwnd": hwnd,
                "title": title,
                "exe": process.map(|p| p.name().to_string_lossy().into_owned()).unwrap_or_default(),
                "path": process.and_then(|p| p.exe()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
            })
        })
        .collect();
    println!("{}", serde_json::to_string(&list)?);
    Ok(())
}

/// Remonte au processus "racine" d'une application.
///
/// Chrome, Discord, Spotify… jouent le son depuis un SOUS-processus (souvent un "service audio").
/// La capture doit viser le processus principal (avec `include_tree`), sinon on ne capte rien.
/// On remonte donc les parents tant qu'ils portent le même nom d'exécutable.
fn root_process(system: &System, pid: u32) -> u32 {
    let mut current = Pid::from_u32(pid);
    let Some(start) = system.process(current) else { return pid };
    let name = start.name().to_os_string();
    while let Some(parent_pid) = system.process(current).and_then(|p| p.parent()) {
        match system.process(parent_pid) {
            Some(parent) if parent.name() == name.as_os_str() => current = parent_pid,
            _ => break,
        }
    }
    current.as_u32()
}

/// Liste les applications qui ont une session audio sur une sortie (haut-parleurs, casque…).
fn list_audio_apps() -> Result<(), Box<dyn std::error::Error>> {
    initialize_mta().ok()?;
    let system = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
    );

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
            let root = root_process(&system, pid);
            let exe = system
                .process(Pid::from_u32(root))
                .map(|p| p.name().to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("Processus {root}"));
            // Pour capturer, ce programme ouvre lui-même une session audio : on ne se liste pas soi-même
            if exe.eq_ignore_ascii_case("umastream-audio.exe") {
                continue;
            }
            let entry = apps.entry(root).or_insert((exe, false));
            entry.1 |= state == SessionState::Active;
        }
    }

    let list: Vec<serde_json::Value> = apps
        .into_iter()
        .map(|(pid, (exe, active))| serde_json::json!({ "pid": pid, "exe": exe, "active": active }))
        .collect();
    println!("{}", serde_json::to_string(&list)?);
    Ok(())
}

/// Capture le son d'une application (et de ses sous-processus) et l'écrit sur la sortie standard.
fn capture(pid: u32) -> Result<(), Box<dyn std::error::Error>> {
    initialize_mta().ok()?;

    // 48 kHz stéréo en flottant 32 bits : le format qu'utilise directement le navigateur (Web Audio).
    // autoconvert : Windows convertit lui-même si l'application joue dans un autre format.
    let format = WaveFormat::new(32, 32, SampleType::Float, 48000, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, true)?;
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
    client.initialize_client(&format, Direction::Capture, mode, None)?;
    let event = client.set_get_eventhandle()?;
    let capture_client = client.get_audiocaptureclient()?;
    client.start_stream()?;

    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut stdout = io::stdout().lock();
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
        // Écriture impossible = l'appli UMAstream a fermé le tuyau (arrêt, ou appli décochée) : on s'arrête.
        if stdout.write_all(a).and_then(|_| stdout.write_all(b)).and_then(|_| stdout.flush()).is_err() {
            let _ = client.stop_stream();
            return Ok(());
        }
        queue.clear();
    }
}
