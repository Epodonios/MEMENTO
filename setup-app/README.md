# MementoSetup (setup-app)

The design-exact MEMENTO Setup wizard — the provided HTML design
(colors, layout, animations, EN/FA i18n) reproduced verbatim as the
installer's real interface, with the demo simulation replaced by a REAL
installation pipeline.

## What the wizard really does

| Step (design) | Real behavior |
| --- | --- |
| Welcome | Live context: payload size, real core versions, real free space |
| Notes | — |
| Destination | Real default `%LOCALAPPDATA%\Programs\MEMENTO`, native directory picker, per-keystroke validation + live free-space meters |
| Installing | validate dest → taskkill a running MEMENTO → stage old install as `.bak-<ts>` → copy payload with per-file progress → REAL wintun sha256 line → HKCU `Uninstall\MEMENTO` registration (Add/Remove Programs) → desktop + Start Menu + "Uninstall MEMENTO" shortcuts |
| Finish | REAL launch: spawns `MEMENTO.exe` detached and quits |

Every failure rolls the previous install back; userData
(`%APPDATA%\com.epodonios.memento`) is never touched.

## Uninstaller

The Add/Remove Programs entry points at:

    "C:\...\MEMENTO.exe" --memento-uninstall

A complete uninstaller inside MEMENTO itself (electron-app/electron/
uninstall.ts + the headless mode in main.ts): kills the cores, kills
every OTHER MEMENTO.exe (own-pid aware), removes the three shortcuts,
deletes the ARP key, then self-deletes the install dir detached —
PRESERVING userData exactly as the wizard's Notes step promises.

## Build (Windows, Node >= 20)

    cd memento-src/electron-app   && npm install && npm run dist      # portable app
    cd ../setup-app               && npm install && npm run dist      # the installer

`setup-app`'s `pre-dist` hook runs `scripts/sync-payload.js`, which
copies `electron-app/release/win-unpacked` into `setup-app/payload`
(the tree the wizard copies onto the user's disk). Artifacts:

    electron-app/release/MEMENTO-<version>.exe       — portable app
    setup-app/release/MementoSetup-<version>.exe     — the installer

## Tests

The pipeline is ELECTRON-FREE (`installerCore.ts`) with injected platform
deps — `scripts/taskF-smoke.mjs` drives the FULL pipeline (copy, ARP
fields, shortcuts, cancel/failure rollback, upgrade path) on any OS.

## ⚠️ Windows Defender / antivirus warnings — READ THIS (2.0.3, updated 2.0.4)

**Honest contract:** the binaries this setup carries and installs are
**not code-signed** — there is no signing certificate for this project
(the MEMENTO contract, disclosed in `electron-app/electron-builder.yml`).
That includes the wizard itself AND the proxy cores it installs:

| Binary | Source | Signature |
| --- | --- | --- |
| `MementoSetup-2.0.4.exe` | this build (electron-builder, unsigned) | none |
| `xray.exe` v25.1.1 | XTLS/Xray-core official release | none (upstream ships unsigned) |
| `sing-box.exe` 1.14.0 | SagerNet official release | none (upstream ships unsigned) |
| `aether.exe` 1.9.0 | CluvexStudio release (sha256-pinned) | none (upstream ships unsigned) |
| `wintun.dll` 0.14.1 | wintun.net (sha256-pinned) | signed by WireGuard — the only signed piece |

Windows Defender (and third-party AVs) judge unsigned executables by
**heuristics**, and an installer that extracts to `%TEMP%`, writes
proxy-core exes, and replicates its own runtime scores high. That is why
some machines see "files were removed by the antivirus".

**What 2.0.3 changed to stop LOOKING like a dropper** (behavior only —
it cannot replace signing):

1. `requestedExecutionLevel: requireAdministrator` — the setup exe asks
   for admin (UAC prompt) per the user's explicit request. Note honestly:
   elevation does NOT whitelist anything; heuristics score behavior and
   content, not the token.
2. The running installer exe is **hardlinked** into the install dir as
   `MEMENTO.exe` — zero bytes of the running image are re-written (the
   plain byte copy of one's own exe is a classic dropper signature).
   Plain copy remains only as the cross-volume fallback.
3. The payload is **moved** (same-volume rename, metadata only) out of
   the volatile `%TEMP%` extraction folder instead of being byte-copied
   through a second location — one fewer full write of every unsigned
   core exe to disk.
4. The completion log says the unsigned-binary contract in plain text
   with the exact Windows Security steps (see below).

### Field report #2 (2.0.4) — the app.asar incident and the fix

On a real Windows 11 machine, setup 2.0.3 reached 100% with an error
line in the log — and the installed app would not launch at all.
Inspection of the installed folder showed why: everything landed EXCEPT
`resources\app.asar` (the app's entire code). Windows Defender removed
it mid-install; 2.0.3's tolerant copy skipped it, kept counting to 100%,
and handed the user a guaranteed-broken install. Electron loads
`resources\app.asar` first — without it the process exits with
`Cannot find module ...\resources\app.asar`.

**What 2.0.4 changed (the tolerance was right for cores, wrong for the
app code):**

1. **Contract gate (pre-copy):** the runtime-reuse payload must contain
   a readable `resources/app.asar`. If an antivirus quarantined it inside
   the staged payload BEFORE the install starts, the setup aborts
   immediately — before creating anything — with the exact Windows
   Security steps.
2. **Verify + heal (post-copy):** every installed file is checked against
   its source size. Files an AV briefly locked during its scan are
   re-copied automatically (3 rounds, ~2.4 s worst case) — transient
   locks heal silently and the log reports them.
3. **Hard gate:** a still-missing `app.asar` (or `MEMENTO.exe`) FAILS the
   install with an error naming the exact file and the Protection-history
   steps. No more broken "100% success".
4. **Leave no trace:** a failed install into a NEW folder removes that
   folder again; a failed install over an EXISTING one restores the
   previous version byte-for-byte (the rollback contract, now also true
   for fresh installs).

The verification summary line in the install log —
`verified 41/41 installed files against the payload manifest` — is the
install's receipt: every file that should be on disk, IS on disk.

**Repair path for a machine hit by the 2.0.3 incident:** allow/restore
`app.asar` in Protection history (or add an exclusion for the install
folder AND `%LOCALAPPDATA%\MementoSetup`), then simply re-run the setup —
it replaces the broken install completely.

**What the setup will NEVER do:** modify antivirus settings, add
exclusions for you, or hide from an AV. Self-modifying exclusions is
malware behavior — if any installer offers that, uninstall it.

### If Defender removes a file — 20-second fix (do this on the REAL machine)

Option A — allow the blocked file and re-run:

1. Windows Security → **Virus & threat protection** → **Protection history**
2. Find the MEMENTO / MementoSetup / xray / sing-box entry → **Actions → Allow**
   (if "Allow" is unavailable, use "Restore" first)
3. Re-run `MementoSetup-2.0.4.exe` (accept the UAC prompt)

Option B — exclude the install folder (persistent, recommended for
unsigned proxy tooling):

1. Windows Security → Virus & threat protection → Manage settings
2. **Exclusions → Add or remove exclusions → Folder**
3. Add the destination folder, default:
   `C:\Users\<you>\AppData\Local\Programs\MEMENTO`
4. Re-run the setup.

Or from an **elevated** PowerShell:

```powershell
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\MEMENTO"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\MementoSetup"
```

(The second path is the setup's private staging folder — quarantines
there abort the install before it even starts.)

**Verification of honesty:** `xray.exe`, `sing-box.exe`, `aether.exe` are
byte-identical to the official upstream releases (aether is sha256-pinned
in `electron-app/electron/aether-versions.json`; wintun is double-pinned).
They are not modified, packed, or obfuscated by this project — if your AV
still flags them, it is flagging the upstream tooling itself.

### Field report #3 (2.0.5) — the 2.0.4 gate fired; now we remove the trigger surface

On the same real Windows 11 machine, **MementoSetup-2.0.4.exe behaved
exactly as designed**: at 1% the contract gate detected that
`resources/app.asar` was already missing from the payload (quarantined by
Defender during the SFX extraction — the log shows `✓ initializing
installer context` and the ✗ line within the same second), named the file,
showed the Windows Security steps and **installed nothing**. That is the
difference from the 2.0.3 incident: no broken “100 % success” anymore.

But the user still could not install. So this round attacks the quarantine
itself. **Root cause of the asar quarantine:** Windows Defender scans
*inside* Electron `app.asar` archives (publicized AMSI capability).
MEMENTO 3.1.7's app code was one opaque 4.1 MB unsigned blob containing
the MHRV engine's literal strings — `certutil -user -addstore Root`,
PowerShell elevation relaunch, `netsh` kill-switch — a prime content-
detection target. Notably the WIZARD's own asar (no such literals)
survived every run — only the app asar died.

**What 2.0.5 changes (blast-radius reduction, honestly not a guarantee):**

1. **Unpacked app payload** (`electron-app/electron-builder.yml` →
   `asar: false`): the app ships as a plain `resources/app/` tree —
   ~114 small files instead of one archive. There is no asar blob left
   for an asar-specific verdict to kill, and a per-file quarantine costs
   ONE small file, which the 2.0.4 verify+heal pass restores from staging
   automatically. Electron loads `resources/app/` natively when
   `app.asar` is absent — zero loader changes (no `app.asar` references
   existed in the app source).
2. **App-tree contract gate**: `CRITICAL_PAYLOAD_FILES` is now
   `resources/app/package.json` + `resources/app/dist-electron/main.js`;
   the gate loops and names every missing critical file.
3. **One-click remediation in the error row** (never automated AV
   changes): new buttons **Copy paths for exclusions** (copies the exact
   candidate folders — the running setup's extraction dir, the
   `%LOCALAPPDATA%\MementoSetup` staging folder, the install destination —
   to the clipboard) and **Open Windows Security**
   (`ms-settings:windowsdefender`). Retry and Back-to-destination were
   already there.
4. **HONEST LIMIT**: we cannot run Defender in this sandbox. Whether the
   unpacked layout ends the quarantine is only provable on a real
   machine (TESTING-CHECKLIST §38). If Defender still flags individual
   JS files, the hard gate will name them and heal restores them —
   but the only complete fix remains **code signing** (needs a
   certificate: budget decision for the project owner).

### راهنمای فارسی — هشدار آنتی‌ویروس

همه‌ی باینری‌های این پکیج **بدون امضای دیجیتال** هستند (هیچ گواهی
امضایی برای این پروژه وجود ندارد؛ همین قرارداد از 3.1.5 علنی است).
Windows Defender چنین فایل‌هایی را با هیوریستیک قضاوت می‌کند و نصب‌کننده‌ای
که از `%TEMP%` باز می‌کند و باینری پروکسی می‌نویسد امتیاز بالایی می‌گیرد —
به همین دلیل روی برخی سیستم‌ها «فایل‌ها توسط آنتی‌ویروس حذف شدند» دیده
می‌شود. نسخه‌ی 2.0.3 رفتارهای شبیه-dropper را حذف کرده (اجرای ستاپ با
اجازه‌ی ادمین، hardlink به‌جای کپیِ فایلِ در حال اجرا، move به‌جای کپیِ
سوم) اما جای امضا را نمی‌گیرد.

اگر Defender فایلی را حذف کرد:

1. **Windows Security → Virus & threat protection → Protection history**
2. روی مورد MEMENTO/xray/sing-box → **Actions → Allow** (اگر نبود، اول Restore)
3. ستاپ را دوباره اجرا کنید؛ یا پوشه‌ی نصب را در **Exclusions** اضافه کنید
   (پیش‌فرض: `C:\Users\<you>\AppData\Local\Programs\MEMENTO`).

ستاپ هرگز تنظیمات آنتی‌ویروس شما را تغییر نمی‌دهد — این کار خودتان و
آگاهانه انجام می‌دهید.

#### گزارش میدانی ۲ (نسخه ۲.۰.۴) — ماجرای app.asar

روی یک ویندوز ۱۱ واقعی، ستاپ ۲.۰.۳ تا ۱۰۰٪ رسید ولی اپ اجرا نمی‌شد.
بررسی پوشه‌ی نصب نشان داد همه‌چیز هست **به‌جز `resources\app.asar`** (کل
کد اپ) — Defender آن را میانه‌ی نصب حذف کرده بود و کپیِ «تحمل‌گر» ۲.۰.۳
بی‌صدا رد شد و نصبِ شکسته را «موفق» اعلام کرد. نسخه‌ی ۲.۰.۴ این حفره را
بسته است:

1. **دروازه‌ی قرارداد (قبل از کپی):** اگر `app.asar` در payload نباشد یا
   خوانده نشود، ستاپ همان اول با راهنمای دقیق Windows Security متوقف
   می‌شود — هیچ فایلی نوشته نمی‌شود.
2. **تأیید + ترمیم (بعد از کپی):** تک‌تک فایل‌های نصب‌شده با سایز مبدأ
   سنجیده می‌شوند؛ فایل‌هایی که آنتی‌ویروس موقتاً قفل کرده به‌طور خودکار
   دوباره کپی می‌شوند.
3. **دروازه‌ی سخت:** اگر `app.asar` (یا `MEMENTO.exe`) واقعاً جا افتاده
   باشد، نصب **شکست می‌خورد** و نام فایل حذف‌شده دقیقاً اعلام می‌شود —
   دیگر هیچ نصب شکسته‌ای «موفق ۱۰۰٪» اعلام نمی‌شود.
4. **بدون ردپا:** نصبِ ناموفق روی پوشه‌ی جدید، آن پوشه را برمی‌دارد؛ روی
   نصب قبلی، نسخه‌ی قبلی دست‌نخورده برمی‌گردد.

مسیر ترمیم برای دستگاهی که ماجرای ۲.۰.۳ برایش پیش آمده: فایل را در
Protection history بازگردانید (یا پوشه‌ی نصب و پوشه‌ی
`%LOCALAPPDATA%\MementoSetup` را مستثنا کنید) و ستاپ را دوباره اجرا کنید.

#### گزارش میدانی ۳ (نسخه ۲.۰.۵) — دروازه‌ی ۲.۰.۴ درست کار کرد؛ حالا خودِ محرک را کم می‌کنیم

روی همان ویندوز واقعی، **ستاپ ۲.۰.۴ دقیقاً طبق طراحی عمل کرد**: در ۱٪،
دروازه‌ی قرارداد دید که `resources/app.asar` همان اول در payload نیست
(Defender حین باز شدن SFX آن را قرنطینه کرده بود — در لاگ، خط ✓ و خط ✗
هر دو در یک ثانیه‌اند)، نام فایل را اعلام کرد، مراحل Windows Security را
نشان داد و **هیچ چیزی نصب نکرد**. این همان تفاوت با ماجرای ۲.۰.۳ است:
دیگر هیچ «موفقیت ۱۰۰٪ شکسته»ای وجود ندارد.

ولی کاربر هنوز نمی‌توانست نصب کند، پس این دور به خودِ علت قرنطینه حمله
می‌کنیم. **ریشه‌ی قرنطینه‌ی asar:** Windows Defender *داخل* آرشیوهای
`app.asar` الکترون را اسکن می‌کند. کد اپ MEMENTO یک بلاک ۴.۱ مگابایتی
بدون امضا بود که شامل رشته‌های تحت‌اللفظی موتور MHRV بود —
`certutil -user -addstore Root`، اجرای مجدد با PowerShell و UAC،
kill-switch با `netsh` — یعنی هدف اصلی تشخیص محتوایی. نکته‌ی گویا: asar
خودِ جادوگر (بدون این رشته‌ها) در همه‌ی اجراها سالم ماند — فقط asar اپ
حذف می‌شد.

**تغییرات ۲.۰.۵ (کاهش شعاع آسیب — صادقانه: تضمین مطلق نیست):**

1. **payload اپ باز‌شده** (`electron-builder.yml` → `asar: false`): کد اپ
   به‌جای یک آرشیو، یک درخت ساده‌ی `resources/app/` با حدود ۱۱۴ فایل
   کوچک است. دیگر بلاک asاری وجود ندارد که یک حکم asar آن را کامل بکشد؛
   قرنطینه‌ی یک فایل یعنی از دست رفتن «یک» فایل کوچک که گذر تأیید+
   ترمیمِ ۲.۰.۴ آن را از staging برمی‌گرداند. الکترون وقتی `app.asar`
   نباشد به‌طور پیش‌فرض `resources/app/` را بار می‌کند — صفر تغییر در
   loader.
2. **دروازه‌ی قرارداد درخت‌آگاه:** `CRITICAL_PAYLOAD_FILES` حالا
   `resources/app/package.json` و `resources/app/dist-electron/main.js`
   است و همه‌ی فایل‌های جاافتاده را نام می‌برد.
3. **رفع مشکل با یک کلیک در ردیف خطا** (هیچ تغییری در تنظیمات AV خودکار
   نمی‌شود): دکمه‌های جدید **کپی مسیرها برای استثنا** (پوشه‌های دقیق —
   پوشه‌ی باز‌شده‌ی ستاپ، staging در `%LOCALAPPDATA%\MementoSetup`، مقصد
   نصب — را در کلیپ‌بورد می‌گذارد) و **باز کردن Windows Security**
   (`ms-settings:windowsdefender`). دکمه‌های Retry و بازگشت از قبل بودند.
4. **محدودیت صادقانه:** در این سندباک Defender نداریم. اینکه چیدمان باز
   قرنطینه را تمام می‌کند فقط روی ویندوز واقعی قابل اثبات است
   (TESTING-CHECKLIST §38). اگر Defender باز هم فایل‌های JS را فلگ کند،
   دروازه‌ی سخت نامشان را می‌گوید و ترمیم برمی‌گرداندشان — اما راه‌حل
   کامل تنها **امضای دیجیتال** است (نیازمند گواهی: تصمیم بودجه‌ای با
   مالک پروژه).

برای همین دستگاه: بعد از استثنا کردن پوشه‌ها (دکمه‌ی «کپی مسیرها» در ردیف
خطا) و Allow/Restore در Protection history، ستاپ را دوباره اجرا کنید.

#### 2.0.6 — the window IS the panel (cosmetic, field feedback)

The 2.0.5 setup rendered inside a transparent 960×730 canvas with the
900×640 panel centered in it plus the panel's CSS drop-shadow — on real
desktops this read as a dark margin/halo around the window. 2.0.6 makes
the Electron window exactly the 900×640 panel: opaque (`#070c09`),
square corners, no outer glow, hint row removed, `fitStage` scales 1:1.
Purely cosmetic — the install pipeline, gates and payload are unchanged.

#### نسخه ۲.۰.۶ — پنجره = خودِ پنل (ظاهری)

ستاپ ۲.۰.۵ داخل یک بوم شفاف ۹۶۰×۷۳۰ با پنل ۹۰۰×۶۴۰ در وسط + شادوی CSS
رندر می‌شد و روی دسکتاپ واقعی مثل یک حاشیه/هاله‌ی تیره دور پنجره دیده
می‌شد. در ۲.۰.۶ پنجره‌ی Electron دقیقاً همان پنل ۹۰۰×۶۴۰ است: مات، گوشه‌های
مربعی، بدون هاله‌ی بیرونی، ردیف راهنما حذف شده و `fitStage` دقیقاً ۱:۱
رندر می‌کند. کاملاً ظاهری — خط لوله‌ی نصب و گیت‌ها بدون تغییر.

### Field report #4 (setup 2.0.7 / app 3.1.8) — custom destination: the EPERM incident

The user picked an existing non-MEMENTO folder as the destination
(`C:\Users\<you>\Downloads`) and the setup aborted with
`cannot stage destination (EPERM: operation not permitted, rename
'C:\Users\…\Downloads' -> 'C:\Users\…\Downloads.bak-…')`. Root cause:
step 3 renamed the ENTIRE destination aside before installing — correct
only for a folder we own, wrong (and on special folders impossible:
Explorer/Telegram/the indexer hold shell handles → EPERM) for any
foreign folder.

**What 2.0.7 changes:**

1. **Ownership rule**: only a destination containing the MEMENTO
   sentinel (`.memento-uninstall.json`) is staged aside (the upgrade
   path with rollback). A foreign folder is installed INTO **in place** —
   nothing of the user's is renamed, moved, or deleted; the log states
   this explicitly.
2. **Honest upgrade abort**: if a real MEMENTO install cannot be staged
   aside (EPERM/EBUSY), the message names the likely causes (running
   app, open Explorer window, AV scan) instead of a bare EPERM.
3. **Leave-no-trace for in-place**: a failed in-place run removes only
   the files the manifest says THIS setup wrote (plus our now-empty
   directories — bare `rmdir` structurally refuses non-empty dirs).
4. **Ownership sentinel upgraded** (now written on ALL platforms, merged
   field-order-safe with the ARP twin): records `inPlace` + the exact
   installed-file list.
5. **App-side uninstall contract (3.1.8)**: the uninstaller reads the
   sentinel — an in-place install is removed FILE-EXACTLY from the
   recorded manifest (temp .bat, one `del /f /q` per file, bare `rmdir`
   per our directory), never `rmdir /s /q` on the whole folder. Uninstall
   inside `Downloads` deletes only MEMENTO's own files. Owned installs
   keep the old whole-dir contract. Path-traversal guard included.

### گزارش میدانی ۴ (ستاپ ۲.۰.۷ / اپ ۳.۱.۸) — مقصد سفارشی و خطای EPERM

کاربر یک پوشه‌ی موجودِ خارج از MEMENTO را مقصد گرفت (`Downloads`) و ستاپ
خواست **کل پوشه** را rename کند — ویندوز به‌خاطر هندل‌های شل (Explorer /
Telegram / ایندکسر) جواب EPERM داد؛ حتی اگر موفق می‌شد، فایل‌های خود
کاربر جابه‌جا می‌شد. قانون جدید ۲.۰.۷:

1. فقط پوشه‌ای که **sentinel** مالکیت (`.memento-uninstall.json`) دارد
   کنار رانده می‌شود (مسیر ارتقا با rollback)؛ پوشه‌ی بیگانه **in place**
   نصب می‌شود — بدون rename/انتقال/حذف هیچ فایل کاربر.
2. اگر نصب واقعی قبلی stage نشد، پیام خطا دلایل احتمالی را نام می‌برد
   (اپ در حال اجرا، پنجره‌ی Explorer باز، اسکن آنتی‌ویروس).
3. شکست نصب in-place فقط فایل‌های نوشته‌شده‌ی همین اجرا را پاک می‌کند.
4. sentinel مالکیت حالا همیشه نوشته می‌شود و `inPlace` + لیست دقیق
   فایل‌ها را دارد.
5. uninstaller اپ (۳.۱.۸) برای نصب in-place فایل‌به‌فایل از روی همان
   لیست حذف می‌کند — uninstall داخل `Downloads` فقط فایل‌های MEMENTO را
   پاک می‌کند، نه پوشه را.
