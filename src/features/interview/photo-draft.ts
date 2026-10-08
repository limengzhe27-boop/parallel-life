import { ApiFailure, type LifeClient } from '../api/client.ts';
/** Tracks only uploads from this editor session, never previously saved assets. */
export class PhotoDraft {
  private uploads = new Set<string>();
  add(id: string) {
    this.uploads.add(id);
  }
  saved(id: string | null) {
    if (id) this.uploads.delete(id);
  }
  async discard(client: Pick<LifeClient, 'discardUnusedUpload'>, keepId: string | null = null) {
    let failure: unknown;
    for (const id of this.uploads) {
      if (id === keepId) continue;
      try {
        await client.discardUnusedUpload(id);
        this.uploads.delete(id);
      } catch (error) {
        // A response lost after save must not delete a referenced photo.
        if (error instanceof ApiFailure && ['CONFLICT', 'NOT_FOUND'].includes(error.code))
          this.uploads.delete(id);
        else failure ??= error;
      }
    }
    if (failure) throw failure;
  }
}
