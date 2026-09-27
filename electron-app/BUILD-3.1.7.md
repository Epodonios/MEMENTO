
### Field feedback round — setup 2.0.6 (cosmetic)
User confirmed 2.0.5 installed and launched cleanly on the real machine
(the unpacked app payload passed real-time scanning). Follow-up request:
remove the dark margin around the setup window. Fix: the Electron window
is now exactly the 900×640 panel — opaque #070c09, square corners,
transparent canvas + CSS drop-shadow margin removed, hint row gone,
fitStage 1:1. Setup-only change; the app exe and the install pipeline are
byte-for-byte the same contract as 2.0.5.
