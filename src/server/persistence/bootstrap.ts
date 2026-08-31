import "server-only";
import { profilesStore, settingsRepository } from "./repositories";

let bootstrapped: Promise<void> | null = null;

/** 首次启动时确保每个已存在档案都有独立的设置、Persona 与 Preset。 */
export function ensureBootstrapped(): Promise<void> {
  if (!bootstrapped) {
    bootstrapped = (async () => {
      const profiles = await profilesStore.read();
      for (const profile of profiles.items) {
        await settingsRepository.ensureForProfile(profile.id, profile.name);
      }
    })().catch((error: unknown) => {
      bootstrapped = null;
      throw error;
    });
  }
  return bootstrapped;
}
