# Local Play scenery and portraits

The visual novel view uses local raster assets; it never calls an image-generation or TTS service.

To supply a scene background, place an image at `world/places/<scene-id>.png`, `.jpg`, `.jpeg`, or `.webp` before creating the Play session. Scene IDs use 1–100 ASCII letters, digits, underscores or hyphens and start with a letter or digit. For example, `world/places/inn.png` matches the scene identity `inn`. Use that identity as the initial scene, or as the public `currentScene` value in Play-local settlement state. The background is chosen when the host freezes that narrative node's `StageSnapshot`; hidden state is never used to select visible scenery. Multiple images with the same scene ID are rejected as ambiguous.

Session creation snapshots up to 12 backgrounds, each at most 256 KiB. Only regular PNG, JPEG and WebP files with matching raster signatures are read; symlinks, hidden paths, traversal and non-raster files are rejected. Existing sessions retain their image bytes when source files change. Create a new session to use changed assets. Retry, Restore and history playback use the background recorded on their own narrative node, not the current sibling branch. Streaming drafts inherit the last committed background until a settlement supplies a new scene.

Character portraits use the same bounded raster reader. Set `looks.refImagePath` in `characters/<character-id>/roster-profile.yaml` to a workspace-relative image path before session creation. Portrait bytes and aliases are frozen with the session and copied into narrative snapshots. Characters without an image show a name silhouette.

Without a matching background, the stage shows its built-in atmospheric backdrop. Day/night/sunset styling remains available with local backgrounds. No image file is created or modified by opening a session.
