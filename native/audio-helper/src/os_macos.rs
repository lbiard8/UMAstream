//! macOS : son par application avec les "process taps" de Core Audio (macOS 14.2 et plus récent).
//!
//! Comment ça marche :
//!   1. on cherche les "objets audio" des processus de l'application (l'appli et ses processus
//!      d'aide : Chrome, Discord… jouent leur son depuis un "Helper") ;
//!   2. on crée un "tap" sur ces processus : une prise d'écoute de leur son, mélangé en stéréo ;
//!      `Unmuted` : tu continues de l'entendre normalement ;
//!   3. on branche ce tap sur un petit périphérique audio privé (invisible dans les réglages),
//!      dont Core Audio nous envoie le son par morceaux ;
//!   4. on le convertit en 48 kHz stéréo si besoin et on l'écrit sur la sortie standard.
//!
//! La première fois, macOS demande l'autorisation « enregistrer l'audio d'autres applications »
//! (texte NSAudioCaptureUsageDescription de l'appli UMAstream).

use std::collections::{BTreeMap, VecDeque};
use std::ffi::c_void;
use std::path::Path;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use objc2::AllocAnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_audio::{
    AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart,
    AudioDeviceStop, AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap,
    AudioHardwareDestroyAggregateDevice, AudioHardwareDestroyProcessTap, AudioObjectGetPropertyData,
    AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress, CATapDescription, CATapMuteBehavior,
    kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey, kAudioAggregateDeviceTapAutoStartKey,
    kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioHardwarePropertyProcessObjectList,
    kAudioHardwarePropertyTranslatePIDToProcessObject, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioObjectUnknown,
    kAudioProcessPropertyIsRunningOutput, kAudioProcessPropertyPID, kAudioSubTapUIDKey, kAudioTapPropertyFormat,
};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
use objc2_core_foundation::CFDictionary;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSUUID};
use sysinfo::{Pid, System};

use crate::Platform;
use crate::common::{AudioApp, CHANNELS, PcmWriter, Result, SAMPLE_RATE, process_list, process_name, root_process};

pub struct MacPlatform;

impl Platform for MacPlatform {
    fn list_audio_apps(&self) -> Result<Vec<AudioApp>> {
        let system = process_list();
        // pid racine -> (nom, active ?). Une appli a souvent plusieurs objets audio (un par Helper).
        let mut apps: BTreeMap<u32, (String, bool)> = BTreeMap::new();
        for object in audio_process_objects()? {
            let Ok(pid) = get_property::<i32>(object, kAudioProcessPropertyPID) else { continue };
            if pid <= 0 {
                continue;
            }
            let running = get_property::<u32>(object, kAudioProcessPropertyIsRunningOutput).unwrap_or(0) != 0;
            let root = root_process(&system, pid as u32, same_bundle);
            if !is_user_app(&system, root) {
                continue; // service interne de macOS (Siri, appels, son système…) : pas une appli à streamer
            }
            let entry = apps.entry(root).or_insert_with(|| (app_name(&system, root), false));
            entry.1 |= running;
        }
        // Une même appli peut apparaître sous plusieurs processus racines : une seule ligne par nom
        // (on garde celle qui joue du son, sinon la première)
        let mut by_name: BTreeMap<String, AudioApp> = BTreeMap::new();
        for (pid, (exe, active)) in apps {
            match by_name.get(&exe) {
                Some(existing) if existing.active || !active => {}
                _ => {
                    by_name.insert(exe.clone(), AudioApp { pid, exe, active });
                }
            }
        }
        Ok(by_name.into_values().collect())
    }

    fn capture(&self, pid: u32, out: &mut PcmWriter) -> Result<()> {
        // 1. Les objets audio de tous les processus de l'application
        let system = process_list();
        let mut objects: Vec<Retained<NSNumber>> = Vec::new();
        for (other, _) in system.processes() {
            if root_process(&system, other.as_u32(), same_bundle) != pid {
                continue;
            }
            if let Ok(object) = translate_pid(other.as_u32() as i32) {
                if object != kAudioObjectUnknown {
                    objects.push(NSNumber::new_u32(object));
                }
            }
        }
        if objects.is_empty() {
            return Err("cette application n'a pas (encore) de son".into());
        }

        // 2. Le tap : une écoute privée du son de ces processus, sans le couper chez toi
        let tap_uuid = NSUUID::new();
        let description = unsafe {
            let description =
                CATapDescription::initStereoMixdownOfProcesses(CATapDescription::alloc(), &NSArray::from_retained_slice(&objects));
            description.setName(&NSString::from_str("UMAstream"));
            description.setUUID(&tap_uuid);
            description.setPrivate(true);
            description.setMuteBehavior(CATapMuteBehavior::Unmuted);
            description
        };
        let mut tap: AudioObjectID = kAudioObjectUnknown;
        check(unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap) }, "création du tap audio (autorisation refusée ?)")?;
        let tap = Owned::new(tap, |id| unsafe {
            AudioHardwareDestroyProcessTap(id);
        });
        let format = get_property::<AudioStreamBasicDescription>(tap.id, kAudioTapPropertyFormat)?;

        // 3. Le périphérique privé qui nous envoie le son du tap
        let device = create_aggregate_device(&tap_uuid.UUIDString())?;
        let device = Owned::new(device, |id| unsafe {
            AudioHardwareDestroyAggregateDevice(id);
        });
        let shared = Arc::new(Captured { samples: Mutex::new(VecDeque::new()) });
        let mut proc_id: AudioDeviceIOProcID = None;
        check(
            unsafe {
                AudioDeviceCreateIOProcID(
                    device.id,
                    Some(on_audio),
                    Arc::as_ptr(&shared) as *mut c_void,
                    NonNull::from(&mut proc_id),
                )
            },
            "création du lecteur audio",
        )?;
        check(unsafe { AudioDeviceStart(device.id, proc_id) }, "démarrage de la capture")?;

        // 4. Toutes les 10 ms : on convertit en 48 kHz stéréo et on écrit
        let mut resampler = Resampler::new(format.mSampleRate);
        let result = loop {
            std::thread::sleep(Duration::from_millis(10));
            let stereo: Vec<f32> = shared.samples.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default();
            if stereo.is_empty() {
                continue;
            }
            let converted = resampler.process(&stereo);
            if out.write_samples(&converted).is_err() {
                break Ok(()); // l'appli UMAstream a fermé le tuyau
            }
        };
        unsafe {
            AudioDeviceStop(device.id, proc_id);
            AudioDeviceDestroyIOProcID(device.id, proc_id);
        }
        drop(device);
        drop(tap);
        drop(shared);
        result
    }
}

/// Le son reçu de Core Audio, en attente d'être écrit (déjà converti en stéréo entrelacé).
struct Captured {
    samples: Mutex<VecDeque<f32>>,
}

/// Appelé par Core Audio (sur son propre fil d'exécution) à chaque morceau de son du tap.
unsafe extern "C-unwind" fn on_audio(
    _device: AudioObjectID,
    _now: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    _input_time: NonNull<AudioTimeStamp>,
    _output: NonNull<AudioBufferList>,
    _output_time: NonNull<AudioTimeStamp>,
    client: *mut c_void,
) -> i32 {
    let captured = unsafe { &*(client as *const Captured) };
    let list = unsafe { input.as_ref() };
    let buffers: &[AudioBuffer] =
        unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), list.mNumberBuffers as usize) };
    let Ok(mut queue) = captured.samples.lock() else { return 0 };
    if buffers.len() == 1 {
        // Cas habituel : un seul tampon, canaux entrelacés (gauche, droite, gauche…)
        let buffer = &buffers[0];
        if buffer.mData.is_null() {
            return 0;
        }
        let channels = (buffer.mNumberChannels as usize).max(1);
        let samples = unsafe { std::slice::from_raw_parts(buffer.mData as *const f32, buffer.mDataByteSize as usize / 4) };
        for frame in samples.chunks_exact(channels) {
            let left = frame[0];
            let right = if channels > 1 { frame[1] } else { left };
            queue.extend([left, right]);
        }
    } else {
        // Un tampon par canal (non entrelacé) : on prend les deux premiers
        let channel = |i: usize| -> &[f32] {
            let buffer = &buffers[i.min(buffers.len() - 1)];
            if buffer.mData.is_null() {
                return &[];
            }
            unsafe { std::slice::from_raw_parts(buffer.mData as *const f32, buffer.mDataByteSize as usize / 4) }
        };
        let (left, right) = (channel(0), channel(1));
        for (l, r) in left.iter().zip(right) {
            queue.extend([*l, *r]);
        }
    }
    // Au-delà d'une demi-seconde en attente, on oublie le plus ancien (l'écriture a dû bloquer)
    let max = SAMPLE_RATE as usize / 2 * CHANNELS;
    while queue.len() > max {
        queue.pop_front();
    }
    0
}

/// Convertit du stéréo à `rate` Hz en stéréo à 48 kHz (interpolation linéaire, suffisante ici).
struct Resampler {
    step: f64, // images d'entrée par image de sortie
    position: f64,
    previous: [f32; 2],
}

impl Resampler {
    fn new(rate: f64) -> Self {
        let rate = if rate > 0.0 { rate } else { f64::from(SAMPLE_RATE) };
        Self { step: rate / f64::from(SAMPLE_RATE), position: 0.0, previous: [0.0; 2] }
    }

    fn process(&mut self, stereo: &[f32]) -> Vec<f32> {
        if (self.step - 1.0).abs() < 1e-9 {
            return stereo.to_vec(); // déjà en 48 kHz
        }
        let frames = stereo.len() / 2;
        let frame = |i: isize, prev: [f32; 2]| -> [f32; 2] {
            if i < 0 { prev } else { [stereo[i as usize * 2], stereo[i as usize * 2 + 1]] }
        };
        let mut out = Vec::with_capacity((frames as f64 / self.step) as usize * 2 + 4);
        // position : où on en est, en images d'entrée, depuis l'image "précédente" (index -1)
        while self.position < frames as f64 - 1.0 {
            let i = self.position.floor() as isize;
            let t = (self.position - i as f64) as f32;
            let (a, b) = (frame(i, self.previous), frame(i + 1, self.previous));
            out.extend([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            self.position += self.step;
        }
        self.position -= frames as f64;
        if frames > 0 {
            self.previous = [stereo[(frames - 1) * 2], stereo[(frames - 1) * 2 + 1]];
        }
        out
    }
}

/// Crée le périphérique audio privé qui contient seulement notre tap.
fn create_aggregate_device(tap_uid: &NSString) -> Result<AudioObjectID> {
    let key = |k: &std::ffi::CStr| NSString::from_str(k.to_str().unwrap_or_default());
    let sub_tap = NSDictionary::<NSString, AnyObject>::from_slices(&[&*key(kAudioSubTapUIDKey)], &[tap_uid.as_ref()]);
    let taps = NSArray::from_retained_slice(&[sub_tap]);
    let uid = NSUUID::new().UUIDString();
    let name = NSString::from_str("UMAstream (capture)");
    let yes = NSNumber::new_bool(true);
    let keys = [
        key(kAudioAggregateDeviceUIDKey),
        key(kAudioAggregateDeviceNameKey),
        key(kAudioAggregateDeviceIsPrivateKey),
        key(kAudioAggregateDeviceTapAutoStartKey),
        key(kAudioAggregateDeviceTapListKey),
    ];
    let values: [&AnyObject; 5] = [uid.as_ref(), name.as_ref(), yes.as_ref(), yes.as_ref(), taps.as_ref()];
    let key_refs: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
    let description = NSDictionary::<NSString, AnyObject>::from_slices(&key_refs, &values);
    // NSDictionary et CFDictionary sont le même objet en mémoire ("toll-free bridging")
    let description: &CFDictionary = unsafe { &*(Retained::as_ptr(&description) as *const CFDictionary) };
    let mut device: AudioObjectID = kAudioObjectUnknown;
    check(
        unsafe { AudioHardwareCreateAggregateDevice(description, NonNull::from(&mut device)) },
        "création du périphérique de capture",
    )?;
    Ok(device)
}

/// Un objet Core Audio, détruit automatiquement à la fin (même en cas d'erreur).
struct Owned<F: Fn(AudioObjectID)> {
    id: AudioObjectID,
    destroy: F,
}

impl<F: Fn(AudioObjectID)> Owned<F> {
    fn new(id: AudioObjectID, destroy: F) -> Self {
        Self { id, destroy }
    }
}

impl<F: Fn(AudioObjectID)> Drop for Owned<F> {
    fn drop(&mut self) {
        (self.destroy)(self.id);
    }
}

fn check(status: i32, what: &str) -> Result<()> {
    if status == 0 { Ok(()) } else { Err(format!("{what} : erreur Core Audio {status}").into()) }
}

fn address(selector: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

/// Lit une propriété de taille fixe d'un objet Core Audio.
fn get_property<T: Copy>(object: AudioObjectID, selector: u32) -> Result<T> {
    let mut value = std::mem::MaybeUninit::<T>::zeroed();
    let mut size = std::mem::size_of::<T>() as u32;
    let mut addr = address(selector);
    check(
        unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&mut addr),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::new(value.as_mut_ptr() as *mut c_void).unwrap(),
            )
        },
        "lecture d'une propriété audio",
    )?;
    Ok(unsafe { value.assume_init() })
}

/// Les objets audio de tous les processus qui utilisent le son (macOS 14.2+).
fn audio_process_objects() -> Result<Vec<AudioObjectID>> {
    let system = kAudioObjectSystemObject as AudioObjectID;
    let mut addr = address(kAudioHardwarePropertyProcessObjectList);
    let mut size: u32 = 0;
    check(
        unsafe { AudioObjectGetPropertyDataSize(system, NonNull::from(&mut addr), 0, std::ptr::null(), NonNull::from(&mut size)) },
        "liste des applications (macOS 14.2 ou plus récent nécessaire)",
    )?;
    let mut objects = vec![0 as AudioObjectID; size as usize / std::mem::size_of::<AudioObjectID>()];
    if objects.is_empty() {
        return Ok(objects);
    }
    check(
        unsafe {
            AudioObjectGetPropertyData(
                system,
                NonNull::from(&mut addr),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::new(objects.as_mut_ptr() as *mut c_void).unwrap(),
            )
        },
        "liste des applications",
    )?;
    objects.truncate(size as usize / std::mem::size_of::<AudioObjectID>());
    Ok(objects)
}

/// L'objet audio d'un processus (kAudioObjectUnknown s'il n'utilise pas le son).
fn translate_pid(pid: i32) -> Result<AudioObjectID> {
    let mut object: AudioObjectID = kAudioObjectUnknown;
    let mut size = std::mem::size_of::<AudioObjectID>() as u32;
    let mut addr = address(kAudioHardwarePropertyTranslatePIDToProcessObject);
    check(
        unsafe {
            AudioObjectGetPropertyData(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&mut addr),
                std::mem::size_of::<i32>() as u32,
                &pid as *const i32 as *const c_void,
                NonNull::from(&mut size),
                NonNull::from(&mut object).cast(),
            )
        },
        "processus introuvable",
    )?;
    Ok(object)
}

/// Le paquet ".app" le plus extérieur qui contient un exécutable
/// ("/Applications/Google Chrome.app/Contents/Frameworks/…/Google Chrome Helper" -> "/Applications/Google Chrome.app").
fn outer_bundle(exe: &Path) -> Option<String> {
    let text = exe.to_string_lossy();
    text.find(".app/").map(|end| text[..end + 4].to_string())
}

/// Sur macOS, les processus d'aide d'une appli ont un autre nom ("Google Chrome Helper") mais sont
/// rangés DANS le paquet de l'appli : on regroupe donc par paquet .app (et par nom, à défaut).
fn same_bundle(child: &sysinfo::Process, parent: &sysinfo::Process) -> bool {
    match (child.exe().and_then(outer_bundle), parent.exe().and_then(outer_bundle)) {
        (Some(a), Some(b)) => a == b,
        (None, None) => child.name() == parent.name(),
        _ => false,
    }
}

/// Une "vraie" application, qu'on peut vouloir streamer : rangée dans un paquet .app, et pas dans
/// /System/Library (où vivent les services internes de macOS : Siri, appels, son système…).
/// Les applis d'Apple utilisables, elles, sont dans /Applications ou /System/Applications (FaceTime…).
fn is_user_app(system: &System, pid: u32) -> bool {
    let bundle = system.process(Pid::from_u32(pid)).and_then(|p| p.exe()).and_then(outer_bundle);
    match bundle {
        Some(path) => !path.starts_with("/System/Library/") && !path.starts_with("/Library/Apple/"),
        None => false, // pas de paquet .app : un programme d'arrière-plan (avconferenced, callservicesd…)
    }
}

/// Nom affiché : celui du paquet ("Google Chrome", "Discord"), sinon celui du processus.
fn app_name(system: &System, pid: u32) -> String {
    let bundle = system.process(Pid::from_u32(pid)).and_then(|p| p.exe()).and_then(outer_bundle);
    match bundle {
        Some(path) => Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| process_name(system, pid)),
        None => process_name(system, pid),
    }
}
