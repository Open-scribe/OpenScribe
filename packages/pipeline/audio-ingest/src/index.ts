export { useAudioRecorder } from "./capture/use-audio-recorder"
export type { RecordedSegment } from "./capture/use-audio-recorder"
export { toAudioIngestError } from "./errors"
export {
  requestSystemAudioStream,
  warmupMicrophonePermission,
  warmupSystemAudioPermission,
  getPrimaryDesktopSource,
} from "./devices/system-audio"
