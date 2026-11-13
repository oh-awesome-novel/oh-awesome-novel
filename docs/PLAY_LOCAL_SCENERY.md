# Local Play scenery and portraits

The visual novel view uses local raster assets; it never calls an image-generation or TTS service.

To supply a scene background, place an image at `world/places/<scene-id>.png`, `.jpg`, `.jpeg`, or `.webp` before creating the Play session. Scene IDs use 1–100 ASCII letters, digits, underscores or hyphens and start with a letter or digit. For example, `world/places/inn.png` matches the scene identity `inn`. Use that identity as the initial scene, or as the public `currentScene` value in Play-local settlement state. The background is chosen when the host freezes that narrative node's `StageSnapshot`; hidden state is never used to select visible scenery. Multiple images with the same scene ID are ambiguous; that scene gets no background, and session creation continues.

Session creation snapshots up to 12 backgrounds, each at most 256 KiB. The initial scene's image is taken first, then the rest in scene-ID order; extra images are skipped rather than failing creation. Only regular PNG, JPEG and WebP files with matching raster signatures are read; symlinks, hidden paths, traversal and non-raster files are rejected. Existing sessions retain their image bytes when source files change. Create a new session to use changed assets. Retry, Restore and history playback use the background recorded on their own narrative node, not the current sibling branch. Streaming drafts inherit the last committed background until a settlement supplies a new scene.

Character portraits use the same bounded raster reader. Set `looks.refImagePath` in `characters/<character-id>/roster-profile.yaml` to a workspace-relative image path before session creation. Portrait bytes and aliases are frozen with the session and copied into narrative snapshots. Characters without an image show a name silhouette.

The workspace also has an image asset directory, `assets/`, with portraits under `assets/portraits/<character-id>/`. It is ignored by Git, is never read by a model, and accepts original PNG, JPEG or WebP files up to 16 MiB; see the Image Asset Directory section of [FILESYSTEM_SPEC](FILESYSTEM_SPEC.md). Authors can copy files into it directly or use “图片资源 → 导入图片” in the Play workspace. Images there are not frozen into sessions. The `looks.refImagePath` snapshot described above is unchanged and still limited to 256 KiB wherever the file lives.

## Prepared portrait sets

A roster profile can also list prepared portraits under `portraits` (field contract in the Character Format section of [FILESYSTEM_SPEC](FILESYSTEM_SPEC.md)). Each has a description and optionally an `image` path inside the asset directory. Authors edit them in “图片资源 → 角色立绘” in the Play workspace; saving proposes a change to `roster-profile.yaml` that is written only after approval, and the image files themselves are never part of that change.

When a session is created it records, per character, the default portrait and up to eight portraits in total: `id`, `label`, `description`, `usage`, the `image` path and the SHA-256 of the image if the file was readable. Image bytes are not stored in the session. Portraits beyond eight are left out and the stage says so. Later edits to the roster affect new sessions only.

The stage shows the character's default portrait by reading the original file from the asset directory each time, without scaling or re-encoding the file. If the file has changed since the session started, it is shown with the note “开局后已更换”. If it is missing or damaged, or the portrait has no image, the stage shows a silhouette; the description is available as a tooltip and the reason is shown under the name. A character with a portrait set no longer gets the `looks.refImagePath` snapshot. `looks.nameColor` (`#RRGGBB`) sets the character's name plate colour on the stage.

Portrait descriptions and paths are not sent to any model by this feature; the frozen prefix and turn requests are the same with or without them.

Without a matching background, the stage shows its built-in atmospheric backdrop. Day/night/sunset styling remains available with local backgrounds. No image file is created or modified by opening a session.
