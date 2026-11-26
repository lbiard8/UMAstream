//! Ce qui est commun à tous les systèmes : les types renvoyés en JSON, l'écriture du son, et la
//! recherche du processus "racine" d'une application.

use std::io::{self, Write};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System, UpdateKind};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Fréquence et nombre de canaux du son écrit sur la sortie standard (ce qu'attend la page).
pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

/// Une application qui a du son (comme une ligne du mélangeur de volume).
#[derive(Serialize)]
pub struct AudioApp {
    pub pid: u32,
    pub exe: String,
    pub active: bool,
}

/// Une fenêtre réduite dans la barre des tâches (Windows).
#[derive(Serialize)]
pub struct MinimizedWindow {
    pub hwnd: isize,
    pub title: String,
    pub exe: String,
    pub path: String,
}

/// Écrit le son capturé (flottants 32 bits, 48 kHz, stéréo entrelacé) vers l'appli UMAstream.
pub struct PcmWriter {
    out: io::StdoutLock<'static>,
}

impl PcmWriter {
    pub fn new(out: io::StdoutLock<'static>) -> Self {
        Self { out }
    }

    /// Écrit des octets déjà au bon format. Erreur = l'appli UMAstream a fermé le tuyau (arrêt,
    /// ou appli décochée) : la capture doit alors s'arrêter.
    pub fn write_bytes(&mut self, parts: &[&[u8]]) -> io::Result<()> {
        for part in parts {
            self.out.write_all(part)?;
        }
        self.out.flush()
    }

    /// Écrit des échantillons stéréo entrelacés.
    pub fn write_samples(&mut self, samples: &[f32]) -> io::Result<()> {
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        self.write_bytes(&[&bytes])
    }
}

/// Liste des processus, avec leur nom, leur parent et leur exécutable.
pub fn process_list() -> System {
    System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet)),
    )
}

/// Nom de l'exécutable d'un processus (ou "Processus 1234" s'il est introuvable).
pub fn process_name(system: &System, pid: u32) -> String {
    system
        .process(Pid::from_u32(pid))
        .map(|p| p.name().to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("Processus {pid}"))
}

/// Remonte au processus "racine" d'une application.
///
/// Chrome, Discord, Spotify… jouent le son depuis un SOUS-processus (souvent un "service audio").
/// La capture doit viser l'application entière : on remonte donc les parents tant qu'ils
/// appartiennent à la même application (`same_app` décide, selon le système).
pub fn root_process(system: &System, pid: u32, same_app: impl Fn(&sysinfo::Process, &sysinfo::Process) -> bool) -> u32 {
    let mut current = Pid::from_u32(pid);
    while let Some(process) = system.process(current) {
        let Some(parent) = process.parent().and_then(|p| system.process(p)) else { break };
        if !same_app(process, parent) {
            break;
        }
        current = parent.pid();
    }
    current.as_u32()
}

// macOS regroupe autrement (par paquet .app) : voir os_macos.rs
#[cfg_attr(target_os = "macos", allow(dead_code))]
/// Même nom d'exécutable : la règle qui marche sous Windows et Linux ("chrome" -> "chrome").
pub fn same_name(child: &sysinfo::Process, parent: &sysinfo::Process) -> bool {
    child.name() == parent.name()
}

