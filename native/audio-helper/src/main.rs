//! umastream-audio : petit programme lancé par l'application UMAstream (Electron).
//!
//! Il fait ce que le navigateur ne sait pas faire :
//!
//!   umastream-audio list
//!       Affiche en JSON les applications qui jouent (ou peuvent jouer) du son :
//!       [{"pid": 1234, "exe": "Discord.exe", "active": true}, ...]
//!
//!   umastream-audio capture <pid>
//!       Capture le son de CETTE application seulement (et de ses sous-processus), et l'écrit en
//!       continu sur la sortie standard : échantillons flottants 32 bits, 48 000 Hz, stéréo,
//!       entrelacés (gauche, droite, gauche, droite…). S'arrête quand l'appli UMAstream ferme le tuyau.
//!
//!   umastream-audio windows
//!       Affiche en JSON les fenêtres RÉDUITES (Windows seulement : ailleurs, une liste vide).
//!       [{"hwnd": 66686, "title": "…", "exe": "Code.exe", "path": "C:\\…\\Code.exe"}, ...]
//!
//!   umastream-audio restore <hwnd>
//!       Rouvre une fenêtre réduite, SANS lui donner le focus (Windows seulement).
//!
//! Ces 4 commandes sont les mêmes sur tous les systèmes : l'appli Electron n'a pas à savoir sur quel
//! système elle tourne. Ce qui change d'un système à l'autre est rangé dans un fichier par système,
//! derrière le trait `Platform` :
//!   os_windows.rs  WASAPI "process loopback" (Windows 11, ou Windows 10 build 20348+)
//!   os_macos.rs    Core Audio "process taps" (macOS 14.2+)
//!   os_linux.rs    PulseAudio (et PipeWire, qui le comprend aussi)

mod common;

#[cfg(target_os = "linux")]
mod os_linux;
#[cfg(target_os = "macos")]
mod os_macos;
#[cfg(target_os = "windows")]
mod os_windows;

use std::io;
use std::process::ExitCode;

use common::{AudioApp, MinimizedWindow, Result};

/// Ce que chaque système doit savoir faire.
pub trait Platform {
    /// Applications qui ont du son (une entrée par application, sur son processus "racine").
    fn list_audio_apps(&self) -> Result<Vec<AudioApp>>;
    /// Capture le son d'une application et de ses sous-processus, jusqu'à ce que `out` soit fermé.
    fn capture(&self, pid: u32, out: &mut common::PcmWriter) -> Result<()>;
    /// Fenêtres réduites (seul Windows en a besoin : ailleurs, Electron les voit déjà).
    fn list_minimized_windows(&self) -> Result<Vec<MinimizedWindow>> {
        Ok(Vec::new())
    }
    /// Rouvre une fenêtre réduite sans lui donner le focus.
    fn restore_window(&self, _handle: isize) -> Result<()> {
        Err("rouvrir une fenêtre réduite n'est possible que sous Windows".into())
    }
}

#[cfg(target_os = "windows")]
fn platform() -> impl Platform {
    os_windows::WindowsPlatform
}
#[cfg(target_os = "macos")]
fn platform() -> impl Platform {
    os_macos::MacPlatform
}
#[cfg(target_os = "linux")]
fn platform() -> impl Platform {
    os_linux::LinuxPlatform
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let platform = platform();
    match args.get(1).map(String::as_str) {
        Some("list") => print_json(platform.list_audio_apps(), "la liste des applications"),
        Some("capture") => {
            let Some(pid) = args.get(2).and_then(|p| p.parse::<u32>().ok()) else {
                eprintln!("Usage : umastream-audio capture <pid>");
                return ExitCode::from(1);
            };
            let mut out = common::PcmWriter::new(io::stdout().lock());
            match platform.capture(pid, &mut out) {
                Ok(()) => ExitCode::SUCCESS,
                Err(err) => {
                    eprintln!("Capture impossible pour le processus {pid} : {err}");
                    ExitCode::from(2)
                }
            }
        }
        Some("windows") => print_json(platform.list_minimized_windows(), "la liste des fenêtres"),
        Some("restore") => {
            let Some(handle) = args.get(2).and_then(|h| h.parse::<isize>().ok()) else {
                eprintln!("Usage : umastream-audio restore <hwnd>");
                return ExitCode::from(1);
            };
            match platform.restore_window(handle) {
                Ok(()) => ExitCode::SUCCESS,
                Err(err) => {
                    eprintln!("Impossible de rouvrir la fenêtre : {err}");
                    ExitCode::from(1)
                }
            }
        }
        _ => {
            eprintln!("Usage : umastream-audio list | capture <pid> | windows | restore <hwnd>");
            ExitCode::from(1)
        }
    }
}

/// Affiche un résultat en JSON sur la sortie standard (ou l'erreur, avec le code de sortie 1).
fn print_json<T: serde::Serialize>(result: Result<T>, what: &str) -> ExitCode {
    match result.and_then(|value| Ok(serde_json::to_string(&value)?)) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("Erreur pendant {what} : {err}");
            ExitCode::from(1)
        }
    }
}
