//! Linux : son par application avec PulseAudio (PipeWire, utilisé par Ubuntu, Fedora…, comprend
//! les mêmes commandes grâce à pipewire-pulse).
//!
//! Chaque application joue son son dans un ou plusieurs "flux" (sink inputs) : Chrome en ouvre un
//! par onglet qui joue. Pour capturer une application, on ÉCOUTE chacun de ses flux (comme
//! `parec --monitor-stream`) : ce que tu entends toi-même ne change pas. Les flux sont mélangés,
//! et ceux qui apparaissent pendant la capture (nouvel onglet…) sont ajoutés automatiquement.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::rc::Rc;
use std::time::{Duration, Instant};

use libpulse_binding as pulse;
use pulse::callbacks::ListResult;
use pulse::context::subscribe::{Facility, InterestMaskSet, Operation as SubscribeOperation};
use pulse::context::{Context, FlagSet as ContextFlags, State as ContextState};
use pulse::def::BufferAttr;
use pulse::mainloop::standard::{IterateResult, Mainloop};
use pulse::sample::{Format, Spec};
use pulse::stream::{FlagSet as StreamFlags, PeekResult, State as StreamState, Stream};

use crate::Platform;
use crate::common::{
    AudioApp, CHANNELS, PcmWriter, Result, SAMPLE_RATE, process_list, process_name, root_process, same_name,
};

pub struct LinuxPlatform;

/// Ce qu'on retient d'un flux audio d'application.
#[derive(Clone)]
struct SinkInput {
    index: u32,
    pid: Option<u32>,
    corked: bool, // en pause (ne joue rien en ce moment)
}

/// Connexion au serveur de son (PulseAudio ou PipeWire).
/// PIÈGE : le contexte doit être fermé AVANT la boucle (sinon libpulse plante à la fermeture) :
/// d'où l'ordre des champs (Rust les libère dans l'ordre) et le `Drop` ci-dessous.
struct SoundServer {
    context: Context,
    mainloop: Mainloop,
}

impl Drop for SoundServer {
    fn drop(&mut self) {
        self.context.disconnect();
    }
}

impl SoundServer {
    fn connect() -> Result<Self> {
        let mut mainloop = Mainloop::new().ok_or("impossible de démarrer la boucle PulseAudio")?;
        let mut context = Context::new(&mainloop, "UMAstream").ok_or("impossible de créer le contexte PulseAudio")?;
        context
            .connect(None, ContextFlags::NOFLAGS, None)
            .map_err(|_| "serveur de son introuvable (PulseAudio ou PipeWire doit être lancé)")?;
        loop {
            iterate(&mut mainloop, true)?;
            match context.get_state() {
                ContextState::Ready => break,
                ContextState::Failed | ContextState::Terminated => {
                    return Err("connexion au serveur de son refusée".into());
                }
                _ => {}
            }
        }
        Ok(Self { context, mainloop })
    }

    /// Fait tourner la boucle jusqu'à ce que `done` devienne vrai.
    fn wait_until(&mut self, done: &Rc<RefCell<bool>>) -> Result<()> {
        while !*done.borrow() {
            iterate(&mut self.mainloop, true)?;
        }
        Ok(())
    }

    /// Tous les flux audio d'applications.
    fn sink_inputs(&mut self) -> Result<Vec<SinkInput>> {
        let found = Rc::new(RefCell::new(Vec::new()));
        let done = Rc::new(RefCell::new(false));
        let (found2, done2) = (found.clone(), done.clone());
        self.context.introspect().get_sink_input_info_list(move |result| match result {
            ListResult::Item(info) => found2.borrow_mut().push(SinkInput {
                index: info.index,
                pid: info.proplist.get_str("application.process.id").and_then(|p| p.parse().ok()),
                corked: info.corked,
            }),
            ListResult::End | ListResult::Error => *done2.borrow_mut() = true,
        });
        self.wait_until(&done)?;
        Ok(found.take())
    }
}

fn iterate(mainloop: &mut Mainloop, block: bool) -> Result<()> {
    match mainloop.iterate(block) {
        IterateResult::Success(_) => Ok(()),
        IterateResult::Quit(_) | IterateResult::Err(_) => Err("la connexion au serveur de son s'est arrêtée".into()),
    }
}

impl Platform for LinuxPlatform {
    fn list_audio_apps(&self) -> Result<Vec<AudioApp>> {
        let mut server = SoundServer::connect()?;
        let system = process_list();
        // pid racine -> (exe, active ?). Une appli peut avoir plusieurs flux (un par onglet…).
        let mut apps: BTreeMap<u32, (String, bool)> = BTreeMap::new();
        for input in server.sink_inputs()? {
            let Some(pid) = input.pid else { continue }; // sans processus connu : impossible à viser
            let root = root_process(&system, pid, same_name);
            let entry = apps.entry(root).or_insert_with(|| (process_name(&system, root), false));
            entry.1 |= !input.corked;
        }
        Ok(apps.into_iter().map(|(pid, (exe, active))| AudioApp { pid, exe, active }).collect())
    }

    fn capture(&self, pid: u32, out: &mut PcmWriter) -> Result<()> {
        let mut server = SoundServer::connect()?;

        // Les nouveaux flux (nouvel onglet qui joue…) : le serveur nous prévient, on vérifie ensuite
        // s'ils appartiennent à l'application.
        let new_inputs: Rc<RefCell<Vec<u32>>> = Rc::new(RefCell::new(Vec::new()));
        let new_inputs2 = new_inputs.clone();
        server.context.set_subscribe_callback(Some(Box::new(move |facility, operation, index| {
            if facility == Some(Facility::SinkInput) && operation == Some(SubscribeOperation::New) {
                new_inputs2.borrow_mut().push(index);
            }
        })));
        server.context.subscribe(InterestMaskSet::SINK_INPUT, |_| {});

        let mut mixer = Mixer::new();
        let mut listened: HashSet<u32> = HashSet::new();
        let mut check_all = true; // au démarrage : tous les flux existants
        loop {
            if check_all || !new_inputs.borrow().is_empty() {
                new_inputs.borrow_mut().clear();
                check_all = false;
                let system = process_list();
                for input in server.sink_inputs()? {
                    let Some(input_pid) = input.pid else { continue };
                    if listened.contains(&input.index) || root_process(&system, input_pid, same_name) != pid {
                        continue;
                    }
                    if let Ok(stream) = listen_to(&mut server.context, input.index) {
                        listened.insert(input.index);
                        mixer.add(stream);
                    }
                }
            }

            iterate(&mut server.mainloop, false)?;
            mixer.read_streams();
            if let Some(chunk) = mixer.next_chunk() {
                if out.write_samples(&chunk).is_err() {
                    return Ok(()); // l'appli UMAstream a fermé le tuyau
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

/// Ouvre un flux d'enregistrement qui écoute UN flux d'application (son "moniteur").
fn listen_to(context: &mut Context, sink_input: u32) -> Result<Stream> {
    let spec = Spec { format: Format::F32le, channels: CHANNELS as u8, rate: SAMPLE_RATE };
    let mut stream = Stream::new(context, "UMAstream (capture)", &spec, None).ok_or("flux impossible à créer")?;
    stream.set_monitor_stream(sink_input).map_err(|_| "flux de l'application introuvable")?;
    // fragsize : le serveur nous envoie le son par morceaux de 10 ms (moins de décalage)
    let bytes_per_10ms = SAMPLE_RATE / 100 * (CHANNELS as u32) * 4;
    let attr = BufferAttr { maxlength: u32::MAX, tlength: u32::MAX, prebuf: u32::MAX, minreq: u32::MAX, fragsize: bytes_per_10ms };
    stream
        .connect_record(None, Some(&attr), StreamFlags::ADJUST_LATENCY | StreamFlags::DONT_MOVE)
        .map_err(|_| "écoute du flux refusée")?;
    Ok(stream)
}

/// Mélange les flux écoutés et les découpe au rythme réel (48 000 images par seconde).
///
/// Un flux en pause n'envoie rien : on ne peut donc pas attendre que TOUS les flux aient du son.
/// On avance à l'horloge : toutes les 10 ms environ, on additionne ce que chaque flux a envoyé
/// (du silence pour ceux qui n'ont rien envoyé).
struct Mixer {
    sources: Vec<(Stream, VecDeque<f32>)>,
    started: Option<Instant>,
    frames_written: u64,
}

/// Au-delà de 150 ms d'avance, un flux perd ses plus vieux échantillons : le décalage du son par
/// rapport à l'image ne peut pas grandir (les horloges du PC et du serveur de son dérivent un peu).
const MAX_QUEUE: usize = SAMPLE_RATE as usize * 15 / 100 * CHANNELS;

impl Mixer {
    fn new() -> Self {
        Self { sources: Vec::new(), started: None, frames_written: 0 }
    }

    fn add(&mut self, stream: Stream) {
        self.sources.push((stream, VecDeque::new()));
    }

    /// Récupère ce que chaque flux a reçu, et oublie les flux terminés (onglet fermé…).
    fn read_streams(&mut self) {
        self.sources.retain_mut(|(stream, queue)| {
            match stream.get_state() {
                StreamState::Failed | StreamState::Terminated => return false,
                StreamState::Ready => {}
                _ => return true, // pas encore prêt
            }
            loop {
                match stream.peek() {
                    Ok(PeekResult::Data(bytes)) => {
                        for sample in bytes.chunks_exact(4) {
                            queue.push_back(f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]));
                        }
                        let _ = stream.discard();
                    }
                    Ok(PeekResult::Hole(_)) => {
                        let _ = stream.discard();
                    }
                    Ok(PeekResult::Empty) => break,
                    Err(_) => return false,
                }
            }
            while queue.len() > MAX_QUEUE {
                queue.pop_front();
            }
            true
        });
    }

    /// Le morceau de son dû depuis le dernier envoi (None s'il n'y a rien à envoyer pour l'instant).
    fn next_chunk(&mut self) -> Option<Vec<f32>> {
        if self.sources.is_empty() {
            self.started = None; // plus rien à écouter : l'horloge repartira au prochain son
            return None;
        }
        // L'horloge ne démarre qu'au PREMIER son reçu. Démarrée avant, elle enverrait du silence en
        // attendant le son (le serveur met un moment à l'envoyer)… et ce retard resterait jusqu'au bout.
        if self.started.is_none() {
            if self.sources.iter().all(|(_, queue)| queue.is_empty()) {
                return None;
            }
            self.started = Some(Instant::now());
            self.frames_written = 0;
        }
        let started = self.started.unwrap();
        let due = (started.elapsed().as_secs_f64() * SAMPLE_RATE as f64) as u64 - self.frames_written;
        if due < u64::from(SAMPLE_RATE / 100) {
            return None; // moins de 10 ms : on attend
        }
        let frames = due.min(u64::from(SAMPLE_RATE / 10)) as usize; // jamais plus de 100 ms d'un coup
        self.frames_written += due; // un retard au-delà de 100 ms est sauté
        let mut chunk = vec![0.0f32; frames * CHANNELS];
        for (_, queue) in &mut self.sources {
            for slot in chunk.iter_mut() {
                match queue.pop_front() {
                    Some(sample) => *slot += sample,
                    None => break,
                }
            }
        }
        for sample in &mut chunk {
            *sample = sample.clamp(-1.0, 1.0); // deux flux forts ensemble ne doivent pas saturer
        }
        Some(chunk)
    }
}
