# Chord Scope

A phone-friendly web app that listens to your piano through the microphone, figures out
which notes are sounding, and shows the chord:

- the chord symbol with quality and extensions (maj7, m9, 7♭9♭13, ø7, 6/9, sus, slash chords, rootless voicings)
- the notes on a grand staff, colored by their role in the chord
- each note's function (R, 3, 5, ♭7, 9, ♯11, 13…), an 88-key map, and your recent chords

Open it over https (e.g. GitHub Pages), tap **Listen**, and allow the microphone.
Add it to your home screen for a full-screen app.

Files: `index.html` (UI), `detect.js` (polyphonic note detection), `chords.js` (chord naming),
`vexflow-bravura.js` (music notation, VexFlow 4.2.5, MIT license).
