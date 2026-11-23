# media/

Project media assets live here (video, images, audio, fonts, LUTs).
This folder is the project `mediaDir` and is read-only at render time: the
framework never writes here and the preview server cannot serve writes.

The starter needs no media file: `npm run render` builds the video from code.
Add assets here and reference them by file name or relative path. Files with
unsupported extensions are ignored by the media index.
