/**
 * MementoSetup — renderer wiring (setup v2.0.0).
 *
 * The visual layer (tokens, layout, animations, i18n strings, step
 * machine) is the provided design, reproduced byte-for-byte. The ONLY
 * change: the demo install simulation is replaced by the REAL installer
 * pipeline driven through `window.setupAPI` (preload contextBridge →
 * main process). With no setupAPI (plain browser / preview) the wizard
 * degrades to the original demo simulation so the design stays
 * reviewable everywhere.
 *
 * Real logic added:
 *   - live context: default destination, free disk space, payload size
 *   - real destination browse dialog + per-keystroke validation with
 *     live free-space meters
 *   - REAL install: payload copy → uninstall registration → shortcuts,
 *     streamed back as log/pct/status events
 *   - real launch (spawns MEMENTO.exe and quits), real window controls
 */
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/vazirmatn/300.css";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/700.css";
import * as Lucide from "lucide";
const ALL_ICONS = (Lucide as any).icons ?? Lucide;

/* =========================================================
   MEMENTO Setup — single wizard state machine
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- i18n dictionary (design, verbatim) ---------------- */
  const I18N: Record<string, Record<string, any>> = {
    en: {
      'title.app': 'MEMENTO Setup',
      'rail.progress': 'Installation',
      'rail.status': 'STATE · IDLE',
      'welcome.from': 'from EPODONIOS',
      'welcome.copy': 'A quiet, developer-grade VPN manager for Windows. This wizard installs the MEMENTO shell, its proxy cores and the elevated TUN helper — nothing else.',
      'welcome.install': 'Install',
      'welcome.customize': 'Customize destination',
      'notes.eyebrow': 'Step 02 · Terms',
      'notes.title': 'License & important notes',
      'notes.desc': 'Please read the following before continuing. These notes describe exactly what MEMENTO installs, what it requests from Windows, and what it leaves behind.',
      'notes.h1': 'What this software does',
      'notes.p1': '<strong>MEMENTO</strong> is a desktop manager for proxy cores. It does not operate a VPN service of its own: it configures, launches and supervises the open-source cores you point it at — <code>V2Ray</code>, <code>Xray</code>, <code>sing-box</code> and the Aether routing engine — and exposes their state through a single dark interface.',
      'notes.li1': 'Core binaries are downloaded once, verified by SHA-256, and stored under <code>resources/</code>.',
      'notes.li2': 'Configuration profiles, routing rules and logs remain on this machine and are never uploaded.',
      'notes.li3': 'MEMENTO runs without administrator privileges for all normal operations.',
      'notes.h2': 'TUN mode & privileges',
      'notes.p2': 'When you enable <strong>TUN mode</strong>, MEMENTO creates a virtual network adapter named <code>MEMENTO TUN</code> (backed by <code>wintun.dll</code>). Windows requires elevation for this single helper process only — a signed UAC prompt will appear the first time TUN mode is activated. The main application stays unelevated.',
      'notes.h3': 'Uninstalling & your data',
      'notes.p3': 'Uninstalling removes the application files, the <code>MEMENTO TUN</code> adapter registration and the Start Menu entries. <strong>Your profiles, subscriptions and settings are preserved</strong> by default, so a reinstall picks up exactly where you left off. A full purge is available from <code>Settings → Maintenance</code>.',
      'notes.h4': 'Antivirus notices',
      'notes.p4': 'The bundled cores are <strong>unsigned open-source binaries</strong>. Some antivirus products may flag them, or flag the TUN adapter creation, as potentially unwanted behaviour. This is a known false positive caused by the nature of the tools, not by MEMENTO itself. Every binary shipped here can be hash-verified against its upstream release.',
      'notes.faHead': 'یادداشت‌ها به فارسی',
      'notes.foot': 'EPODONIOS OSS EULA · rev. 2025-02',
      'notes.accept': 'Accept & continue',
      'common.back': 'Back',
      'dest.eyebrow': 'Step 03 · Location',
      'dest.title': 'Choose where MEMENTO is installed',
      'dest.desc': 'The destination must be an absolute Windows path on a writable volume. Approximately 412 MB will be used.',
      'dest.pathLabel': 'Destination folder',
      'dest.browse': 'Browse…',
      'dest.error': 'Invalid path. Use an absolute Windows path such as C:\\Program Files\\MEMENTO.',
      'dest.required': 'Required space',
      'dest.available': 'Available space',
      'dest.shortcut': 'Create desktop shortcut',
      'dest.install': 'Install now',
      'dest.foot': 'Elevated helper is NOT installed at this stage',
      'install.eyebrow': 'Step 04 · Installing',
      'install.title': 'Installing MEMENTO',
      'install.desc': 'Keep this window open. Cores are unpacked, hash-verified and registered in sequence.',
      'install.working': 'Transferring',
      'install.details': 'Show details',
      'install.detailsHide': 'Hide details',
      'install.verify': 'SHA-256 verification enabled',
      'finish.title1': 'MEMENTO is',
      'finish.title2': 'ready.',
      'finish.copy': 'All components were installed and verified. Launch MEMENTO to add your first core profile, or close this wizard and start it later from the Start Menu.',
      'finish.item1': 'Cores installed & hash-verified',
      'finish.item2': 'MEMENTO TUN hooks registered',
      'finish.item3': 'Desktop shortcut created',
      'finish.item4': 'Uninstaller written',
      'finish.launch': 'Launch MEMENTO',
      'finish.finish': 'Finish',
      'finish.installed': 'Installed to',
      'hint.primary': 'primary action',
      'hint.back': 'back',
      'steps': ['Welcome', 'Notes', 'Destination', 'Installing', 'Finish'],
      // wiring additions (real-installer states; design strings untouched)
      'dest.errorSpace': 'Not enough free space on this volume — MEMENTO needs about {need} but only {free} is available.',
      'state.idle': 'STATE · IDLE',
      'state.preparing': 'STATE · PREPARING',
      'state.installing': 'STATE · INSTALLING',
      'state.done': 'STATE · DONE',
      'state.error': 'STATE · ERROR',
      'install.retry': 'Retry install',
      'install.backToDest': 'Back to destination',
      'install.copyPaths': 'Copy paths for exclusions',
      'install.copied': 'Copied ✓',
      'install.openDefender': 'Open Windows Security',
      'install.launching': 'Launching…',
    },
    fa: {
      'title.app': 'نصب‌کننده MEMENTO',
      'rail.progress': 'فرآیند نصب',
      'rail.status': 'وضعیت · آماده',
      'welcome.from': 'از EPODONIOS',
      'welcome.copy': 'یک مدیر VPN آرام و حرفه‌ای برای ویندوز. این فرآیند فقط پوسته MEMENTO، هسته‌های پراکسی و ابزار کمکی TUN را نصب می‌کند — هیچ چیز دیگری.',
      'welcome.install': 'نصب',
      'welcome.customize': 'تغییر مسیر نصب',
      'notes.eyebrow': 'گام ۰۲ · شرایط',
      'notes.title': 'مجوز و نکات مهم',
      'notes.desc': 'لطفاً پیش از ادامه، موارد زیر را مطالعه کنید. این نکات دقیقاً توضیح می‌دهند چه چیزی نصب می‌شود، چه دسترسی‌هایی از ویندوز درخواست می‌شود و چه چیزی باقی می‌ماند.',
      'notes.h1': 'این نرم‌افزار چه می‌کند',
      'notes.p1': '<strong>MEMENTO</strong> یک مدیر دسکتاپ برای هسته‌های پراکسی است و سرویس VPN مستقلی ارائه نمی‌دهد؛ بلکه هسته‌های متن‌باز <code>V2Ray</code>، <code>Xray</code>، <code>sing-box</code> و موتور مسیریابی Aether را پیکربندی، اجرا و پایش می‌کند.',
      'notes.li1': 'فایل‌های هسته یک بار دریافت، با SHA-256 بررسی و در مسیر <code>resources/</code> ذخیره می‌شوند.',
      'notes.li2': 'پروفایل‌ها، قوانین مسیریابی و لاگ‌ها فقط روی همین سیستم می‌مانند و هرگز ارسال نمی‌شوند.',
      'notes.li3': 'MEMENTO برای همه عملیات عادی بدون دسترسی مدیر اجرا می‌شود.',
      'notes.h2': 'حالت TUN و دسترسی‌ها',
      'notes.p2': 'با فعال‌سازی <strong>حالت TUN</strong>، یک کارت شبکه مجازی به نام <code>MEMENTO TUN</code> (بر پایه <code>wintun.dll</code>) ساخته می‌شود. ویندوز فقط برای همین فرآیند کمکی درخواست دسترسی مدیریتی (UAC) می‌کند و خود برنامه بدون دسترسی ارتقاءیافته باقی می‌ماند.',
      'notes.h3': 'حذف برنامه و داده‌های شما',
      'notes.p3': 'حذف برنامه، فایل‌های اجرایی، ثبت کارت شبکه <code>MEMENTO TUN</code> و میان‌برهای منوی استارت را پاک می‌کند. اما <strong>پروفایل‌ها، اشتراک‌ها و تنظیمات شما به‌صورت پیش‌فرض حفظ می‌شوند</strong> تا نصب مجدد از همان نقطه ادامه یابد.',
      'notes.h4': 'هشدارهای آنتی‌ویروس',
      'notes.p4': 'هسته‌های همراه <strong>باینری‌های متن‌باز بدون امضای دیجیتال</strong> هستند. برخی آنتی‌ویروس‌ها ممکن است به دلیل ماهیت این ابزارها هشدار نادرست نشان دهند. صحت همه فایل‌ها با هش SHA-256 در برابر نسخه رسمی قابل بررسی است.',
      'notes.faHead': 'یادداشت‌ها به فارسی',
      'notes.foot': 'قرارداد مجوز متن‌باز EPODONIOS · ویرایش ۲۰۲۵-۰۲',
      'notes.accept': 'می‌پذیرم و ادامه می‌دهم',
      'common.back': 'بازگشت',
      'dest.eyebrow': 'گام ۰۳ · مسیر نصب',
      'dest.title': 'محل نصب MEMENTO را انتخاب کنید',
      'dest.desc': 'مسیر باید یک مسیر مطلق ویندوز روی یک درایو قابل‌نوشتن باشد. به‌طور تقریبی ۴۱۲ مگابایت استفاده خواهد شد.',
      'dest.pathLabel': 'پوشه مقصد',
      'dest.browse': 'مرور…',
      'dest.error': 'مسیر نامعتبر است. یک مسیر مطلق ویندوز مانند C:\\Program Files\\MEMENTO وارد کنید.',
      'dest.required': 'فضای موردنیاز',
      'dest.available': 'فضای موجود',
      'dest.shortcut': 'ایجاد میان‌بر در دسکتاپ',
      'dest.install': 'شروع نصب',
      'dest.foot': 'ابزار کمکی ارتقاءیافته در این مرحله نصب نمی‌شود',
      'install.eyebrow': 'گام ۰۴ · نصب',
      'install.title': 'در حال نصب MEMENTO',
      'install.desc': 'این پنجره را باز نگه دارید. هسته‌ها به‌ترتیب استخراج، بررسی و ثبت می‌شوند.',
      'install.working': 'در حال انتقال',
      'install.details': 'نمایش جزئیات',
      'install.detailsHide': 'پنهان‌سازی جزئیات',
      'install.verify': 'بررسی SHA-256 فعال است',
      'finish.title1': 'MEMENTO',
      'finish.title2': 'آماده است.',
      'finish.copy': 'همه اجزا نصب و تأیید شدند. برای افزودن اولین پروفایل، MEMENTO را اجرا کنید یا این فرآیند را ببندید و بعداً از منوی استارت برنامه را باز کنید.',
      'finish.item1': 'هسته‌ها نصب و هش‌شان تأیید شد',
      'finish.item2': 'هوک‌های MEMENTO TUN ثبت شدند',
      'finish.item3': 'میان‌بر دسکتاپ ساخته شد',
      'finish.item4': 'حذف‌کننده نوشته شد',
      'finish.launch': 'اجرای MEMENTO',
      'finish.finish': 'پایان',
      'finish.installed': 'نصب‌شده در',
      'hint.primary': 'عمل اصلی',
      'hint.back': 'بازگشت',
      'steps': ['شروع', 'یادداشت‌ها', 'مسیر نصب', 'در حال نصب', 'پایان'],
      'dest.errorSpace': 'فضای کافی روی این درایو نیست — MEMENTO حدود {need} نیاز دارد اما فقط {free} موجود است.',
      'state.idle': 'وضعیت · آماده',
      'state.preparing': 'وضعیت · آماده‌سازی',
      'state.installing': 'وضعیت · در حال نصب',
      'state.done': 'وضعیت · انجام شد',
      'state.error': 'وضعیت · خطا',
      'install.retry': 'تلاش دوباره برای نصب',
      'install.backToDest': 'بازگشت به مسیر نصب',
      'install.copyPaths': 'کپی مسیرها برای استثنا',
      'install.copied': 'کپی شد ✓',
      'install.openDefender': 'باز کردن Windows Security',
      'install.launching': 'در حال اجرا…',
    }
  };

  /* ---------------- wizard state ---------------- */
  const state = {
    step: 0,
    lang: 'en',
    shortcut: true,
    path: 'C:\\Users\\you\\AppData\\Local\\Programs\\MEMENTO',
    installing: false,
    finished: false,
    detailsOpen: false
  };

  const $  = (s: string, r?: any) => (r || document).querySelector(s);
  const $$ = (s: string, r?: any) => Array.from((r || document).querySelectorAll(s));

  const windowEl   = $('#window') as HTMLElement;
  const timelineEl = $('#timeline') as HTMLElement;
  const tlProgress = $('#tlProgress') as HTMLElement;
  const steps      = $$('.step') as HTMLElement[];
  const pathInput  = $('#pathInput') as HTMLInputElement;
  const pathWrap   = $('#pathWrap') as HTMLElement;
  const pathError  = $('#pathError') as HTMLElement;
  const progressEdge = $('#progressEdge') as HTMLElement;
  const progressFill = $('#progressFill') as HTMLElement;
  const railFootState = $('.rail-foot .k span:last-child') as HTMLElement;

  /* ---------------- setupAPI (real installer bridge) ---------------- */
  interface SetupContext {
    appVersion: string;
    setupVersion: string;
    defaultDir: string;
    freeBytes: number | null;
    payload: { fileCount: number; totalBytes: number };
    cores: { xray?: string; singbox?: string; aether?: string };
  }
  type SetupEvent =
    | { type: 'log'; line: string; ts: string; verbose?: boolean; error?: boolean }
    | { type: 'pct'; pct: number; sub?: string }
    | { type: 'status'; text: string }
    | { type: 'done'; destDir: string }
    | { type: 'error'; message: string };

  interface SetupAPI {
    getContext(): Promise<SetupContext>;
    statPath(p: string): Promise<{ valid: boolean; freeBytes: number | null; reason?: string }>;
    chooseDir(current: string): Promise<string | null>;
    start(opts: { destDir: string; createDesktopShortcut: boolean }): Promise<boolean>;
    cancel(): void;
    launch(): void;
    close(): void;
    minimize(): void;
    onEvent(cb: (ev: SetupEvent) => void): () => void;
  }

  const api: SetupAPI | null = (typeof window !== 'undefined' && (window as any).setupAPI) || null;
  let ctx: SetupContext | null = null;
  let uninstallOff: (() => void) | null = null;

  const fmtBytes = (n: number | null | undefined): string => {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1) + ' GB';
    if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(n >= 1024 ** 3 ? 0 : 1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return String(n) + ' B';
  };

  /* ---------------- step rail ---------------- */
  function buildRail() {
    const labels = I18N[state.lang].steps;
    $$('.tl-item', timelineEl).forEach((n: any) => n.remove());
    labels.forEach((label: string, i: number) => {
      const item = document.createElement('div');
      item.className = 'tl-item';
      item.innerHTML = '<span class="tl-node"></span><span class="tl-label">' +
        String(i + 1).padStart(2, '0') + ' · ' + label + '</span>';
      timelineEl.appendChild(item);
    });
    paintRail();
  }

  function paintRail() {
    const items = $$('.tl-item', timelineEl);
    items.forEach((item: any, i: number) => {
      item.classList.toggle('done', i < state.step);
      item.classList.toggle('current', i === state.step);
    });
    const pct = items.length > 1 ? (state.step / (items.length - 1)) * 100 : 0;
    tlProgress.style.height = 'calc(' + pct + '% - ' + (pct === 100 ? '6px' : '0px') + ')';
  }

  function setStateLabel(key: string) {
    if (railFootState) railFootState.textContent = I18N[state.lang][key] || key;
  }

  /* ---------------- step transitions ---------------- */
  function goTo(next: number, instant?: boolean) {
    next = Math.max(0, Math.min(steps.length - 1, next));
    if (next === state.step && !instant) return;

    const dir = next > state.step ? 1 : -1;
    steps.forEach((el: any, i: number) => {
      el.classList.remove('active', 'before');
      if (i === next) {
        el.classList.add('active');
      } else if (dir > 0 ? i < next : i > next) {
        el.classList.add('before');
      }
      el.setAttribute('aria-hidden', i === next ? 'false' : 'true');
    });

    state.step = next;
    paintRail();

    if (next === 2) { animateMeters(); }
    if (next === 3) startInstall();
    if (next === 4) {
      progressEdge.classList.remove('visible');
      ($('#finishPath') as HTMLElement).textContent = state.path;
    }
  }

  function animateMeters() {
    $$('.track > span').forEach((s: any) => { s.style.width = '0%'; });
    requestAnimationFrame(() => {
      setTimeout(() => {
        $$('.track > span').forEach((s: any) => { s.style.width = s.dataset.fill + '%'; });
      }, 60);
    });
  }

  /* ---------------- destination meters (REAL free space) ---------------- */
  function paintMeters(freeBytes: number | null, driveLabel: string) {
    const total = ctx?.payload?.totalBytes ?? 0;
    const fills = $$('.meters .track > span') as HTMLElement[];
    const vals = $$('.meters .meter-val') as HTMLElement[];
    if (fills.length < 2 || vals.length < 2) return;
    const need = total || 412 * 1024 * 1024;
    const free = freeBytes;
    const ratio = free && free > 0 ? Math.min(100, Math.max(2, Math.round((need / free) * 100))) : 100;
    const freePct = free && free > 0 ? Math.min(100, Math.max(2, Math.round((free / (512 * 1024 ** 3)) * 100))) : 2;
    vals[0].innerHTML = fmtBytes(need) + ' <em>/ ' + fmtBytes(free) + '</em>';
    vals[1].innerHTML = fmtBytes(free) + ' <em>' + driveLabel + '</em>';
    fills[0].dataset.fill = String(ratio);
    fills[1].dataset.fill = String(freePct);
  }

  async function refreshPathStats() {
    const v = pathInput.value.trim();
    paintMeters(ctx ? ctx.freeBytes : null, 'C:');
    if (!api || !v) return;
    try {
      const st = await api.statPath(v);
      const drive = /^[A-Za-z]:\\/.test(v) ? v.slice(0, 2) + ':' : v.split(/[\\/]/)[0] || '';
      paintMeters(st.freeBytes, drive);
    } catch { /* best-effort */ }
  }

  /* ---------------- primary / back actions ---------------- */
  function pathProblem(): string | null {
    const v = pathInput.value.trim();
    const INVALID_CHARS = /[<>:"|?*]/;
    const driveOk = /^[A-Za-z]:\\/.test(v);
    const tail = v.slice(3);
    const shapeOk = driveOk && tail.length > 0 && !INVALID_CHARS.test(tail) && !/[\s.]$/.test(v);
    if (!shapeOk) return 'invalid';
    return null;
  }

  async function primaryAction() {
    switch (state.step) {
      case 0: goTo(1); break;
      case 1: goTo(2); break;
      case 2: {
        const problem = pathProblem();
        if (problem) {
          pathWrap.classList.add('invalid');
          pathError.classList.add('show');
          pathInput.focus();
          return;
        }
        // REAL space gate (desktop only; the demo browser mode keeps the
        // design's shape-only validation).
        if (api && ctx) {
          try {
            const st = await api.statPath(pathInput.value.trim());
            if (st.valid && st.freeBytes !== null && ctx.payload.totalBytes > 0 && st.freeBytes < ctx.payload.totalBytes) {
              const dict = I18N[state.lang];
              const msg = (dict['dest.errorSpace'] || '')
                .replace('{need}', fmtBytes(ctx.payload.totalBytes))
                .replace('{free}', fmtBytes(st.freeBytes));
              ($('[data-i18n]', pathError) as HTMLElement).textContent = msg;
              pathWrap.classList.add('invalid');
              pathError.classList.add('show');
              pathInput.focus();
              return;
            }
          } catch { /* stat failed — continue, the installer re-checks */ }
        }
        pathError.classList.remove('show');
        state.path = pathInput.value.trim();
        goTo(3);
        break;
      }
      case 3: break;
      case 4: {
        // REAL launch — main spawns MEMENTO and quits this wizard.
        const btn = $('.finish .btn-primary') as HTMLElement;
        if (btn) {
          const span = $('span', btn) as HTMLElement;
          const original = span.textContent;
          span.textContent = I18N[state.lang]['install.launching'];
          btn.style.pointerEvents = 'none';
          setTimeout(() => {
            span.textContent = original;
            btn.style.pointerEvents = '';
          }, 1600);
        }
        if (api) api.launch();
        break;
      }
    }
  }

  function flashLaunch() { /* replaced by the real launch in primaryAction */ }

  $$('[data-primary]').forEach((b) => b.addEventListener('click', primaryAction));
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => goTo(state.step - 1)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const to = parseInt((b as HTMLElement).dataset.goto || '0', 10);
    if (state.step === 4) { api ? api.close() : goTo(0); return; }
    goTo(to);
  }));

  /* ---------------- path validation ---------------- */
  function validatePath() {
    const bad = pathProblem();
    pathWrap.classList.toggle('invalid', !!bad);
    pathError.classList.toggle('show', !!bad);
    return !bad;
  }
  pathInput.addEventListener('input', () => { validatePath(); void refreshPathStats(); });
  pathInput.addEventListener('blur', validatePath);
  ($('#browseBtn') as HTMLElement).addEventListener('click', async () => {
    if (api) {
      const picked = await api.chooseDir(pathInput.value.trim());
      if (picked) {
        pathInput.value = picked;
        validatePath();
        void refreshPathStats();
        pathInput.focus();
      }
      return;
    }
    // demo fallback (design behavior)
    const options = [
      'C:\\Program Files\\MEMENTO',
      'D:\\Tools\\MEMENTO',
      'C:\\Users\\you\\AppData\\Local\\Programs\\MEMENTO'
    ];
    const current = options.indexOf(pathInput.value.trim());
    pathInput.value = options[(current + 1) % options.length];
    validatePath();
    pathInput.focus();
  });

  /* ---------------- shortcut switch ---------------- */
  const switchEl = $('#shortcutSwitch') as HTMLElement;
  switchEl.addEventListener('click', () => {
    state.shortcut = switchEl.getAttribute('aria-checked') !== 'true';
    switchEl.setAttribute('aria-checked', String(state.shortcut));
  });

  /* ---------------- REAL install console ---------------- */
  const logBody   = $('#logBody') as HTMLElement;
  const pctValue  = $('#pctValue') as HTMLElement;
  const installSub = $('#installSub') as HTMLElement;
  const logCounter = $('#logCounter') as HTMLElement;
  const installOrb = $('#installOrb') as HTMLElement;
  let logTotal = 0;
  let logSeen = 0;
  const errorRow = document.createElement('div');
  errorRow.className = 'install-error-row';
  errorRow.setAttribute('hidden', '');

  function setOrb(mode: 'idle' | 'installing' | 'success') {
    if (installOrb) installOrb.setAttribute('data-mode', mode);
  }

  function ensureErrorRow() {
    const wrap = logBody.parentElement as HTMLElement;
    if (!wrap) return;
    const foot = wrap.querySelector('.install-foot') as HTMLElement | null;
    if (foot && errorRow.parentElement !== foot.parentElement) {
      foot.parentElement!.insertBefore(errorRow, foot);
    }
  }

  function showErrorRow(message: string) {
    ensureErrorRow();
    errorRow.innerHTML =
      '<button class="btn btn-primary" data-retry type="button"><i data-lucide="play"></i><span>' +
      I18N[state.lang]['install.retry'] + '</span></button>' +
      '<button class="link-ghost" data-copypaths type="button"><i data-lucide="clipboard-copy"></i><span>' +
      I18N[state.lang]['install.copyPaths'] + '</span></button>' +
      '<button class="link-ghost" data-opendefender type="button"><i data-lucide="shield-check"></i><span>' +
      I18N[state.lang]['install.openDefender'] + '</span></button>' +
      '<button class="link-ghost" data-backdest type="button"><span>' +
      I18N[state.lang]['install.backToDest'] + '</span><i data-lucide="arrow-left"></i></button>';
    errorRow.removeAttribute('hidden');
    const retry = errorRow.querySelector('[data-retry]') as HTMLElement;
    const back = errorRow.querySelector('[data-backdest]') as HTMLElement;
    const copyBtn = errorRow.querySelector('[data-copypaths]') as HTMLElement;
    const defenderBtn = errorRow.querySelector('[data-opendefender]') as HTMLElement;
    retry.addEventListener('click', () => { errorRow.setAttribute('hidden', ''); startInstall(); });
    back.addEventListener('click', () => { errorRow.setAttribute('hidden', ''); goTo(2); });
    // Field report #3 (setup 2.0.5): one-click remediation for the exact
    // failure this round shipped with — Defender quarantining the payload.
    // The setup itself still never touches AV settings: these helpers only
    // COPY the exclusion candidate paths (main process) and OPEN Windows
    // Security. The user stays in control of every click.
    copyBtn.addEventListener('click', async () => {
      const label = copyBtn.querySelector('span') as HTMLElement;
      try {
        await (api as any).copyPayloadPaths();
        if (label) label.textContent = I18N[state.lang]['install.copied'];
      } catch {
        if (label) label.textContent = message.slice(0, 80);
      }
    });
    defenderBtn.addEventListener('click', async () => {
      try { await (api as any).openDefender(); } catch { /* no-op */ }
    });
    if ((window as any).lucideCreateIcons) (window as any).lucideCreateIcons();
  }

  function appendLine(line: string, ts: string, verbose: boolean, error: boolean) {
    const item = document.createElement('div');
    item.className = 'log-line' + (verbose ? ' verbose' : '') + (error ? ' error' : '') +
      (state.detailsOpen || !verbose ? '' : ' hidden-verbose');
    item.innerHTML =
      '<span class="ts">' + ts + '</span>' +
      '<span class="mark">' + (error ? '✗' : '›') + '</span>' +
      '<span class="msg"></span>';
    (item.querySelector('.msg') as HTMLElement).textContent = line;
    logBody.appendChild(item);
    logBody.scrollTop = logBody.scrollHeight;

    const lines = $$('.log-line', logBody);
    if (lines.length > 1) {
      const prev = lines[lines.length - 2] as HTMLElement;
      if (!prev.classList.contains('error')) {
        prev.classList.remove('active');
        prev.classList.add('done');
        const mk = $('.mark', prev) as HTMLElement;
        if (mk && mk.textContent !== '✗') mk.textContent = '✓';
      }
    }
    item.classList.add('active');
    logSeen = lines.length;
    logCounter.textContent = logSeen + ' / ' + logTotal;
    if (logTotal > 0 && logSeen > logTotal) logCounter.textContent = String(logSeen);
  }

  function finalizeLog() {
    const lines = $$('.log-line', logBody);
    lines.forEach((l: any) => {
      l.classList.remove('active');
      l.classList.add('done');
      const mk = $('.mark', l);
      if (mk && mk.textContent !== '✗') mk.textContent = '✓';
    });
    progressFill.style.width = '100%';
    pctValue.textContent = '100';
  }

  function clearInstall() {
    logBody.innerHTML = '';
    logSeen = 0;
    errorRow.setAttribute('hidden', '');
  }

  function startInstall() {
    clearInstall();
    state.installing = true;
    setOrb('installing');
    setStateLabel('state.installing');
    progressEdge.classList.add('visible');
    progressFill.style.width = '0%';
    pctValue.textContent = '0';
    installSub.textContent = '';

    if (!api) {
      // DEMO fallback — the original design simulation (browser preview).
      demoInstall();
      return;
    }
    setStateLabel('state.preparing');
    if (uninstallOff) uninstallOff();
    uninstallOff = api.onEvent((ev) => {
      if (ev.type === 'log') {
        if (logTotal === 0) logTotal = 10; // design rhythm: 10 lines
        appendLine(ev.line, ev.ts, !!ev.verbose, !!ev.error);
        installSub.textContent = ev.line.replace('…', '');
      } else if (ev.type === 'pct') {
        progressFill.style.width = Math.max(0, Math.min(100, ev.pct)).toFixed(2) + '%';
        pctValue.textContent = String(Math.floor(ev.pct));
        if (ev.sub) installSub.textContent = ev.sub;
      } else if (ev.type === 'status') {
        installSub.textContent = ev.text;
      } else if (ev.type === 'done') {
        state.installing = false;
        setOrb('success');
        setStateLabel('state.done');
        finalizeLog();
        state.path = ev.destDir;
        setTimeout(() => goTo(4), 850);
      } else if (ev.type === 'error') {
        state.installing = false;
        setOrb('idle');
        setStateLabel('state.error');
        appendLine(ev.message, nowStamp(), false, true);
        showErrorRow(ev.message);
      }
    });
    void api.start({ destDir: state.path, createDesktopShortcut: state.shortcut });
  }

  function nowStamp(): string {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  /* the original design simulation, kept as the no-API fallback */
  const LOG = [
    { t: 'initializing installer context',            d: 700,  v: true },
    { t: 'unpacking cores…',                          d: 900 },
    { t: 'xray-core v25.1.1 → resources/xray/',       d: 1100 },
    { t: 'sing-box 1.14.0 → resources/sing-box/',     d: 1100 },
    { t: 'aether 1.9.0 → resources/aether/',          d: 950 },
    { t: 'pinning wintun.dll 0.14.1 (sha256 verified)', d: 1150 },
    { t: 'registering MEMENTO TUN adapter hooks',     d: 1000 },
    { t: 'writing uninstaller',                       d: 820 },
    { t: 'linking start menu entries',                d: 700, v: true },
    { t: 'installation complete',                     d: 520 }
  ];
  let installTimers: any[] = [];
  let rafId: number | null = null;

  function demoInstall() {
    installTimers.forEach(clearTimeout);
    installTimers = [];
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    const total = LOG.reduce((a, b) => a + b.d, 0);
    const start = performance.now();
    let elapsed = 0;

    const tick = (now: number) => {
      const e = Math.min(now - start, total);
      const p = (e / total) * 100;
      progressFill.style.width = p.toFixed(2) + '%';
      pctValue.textContent = String(Math.floor(p));
      if (e < total && rafId !== null) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    LOG.forEach((item, i) => {
      elapsed += item.d;
      installTimers.push(setTimeout(() => {
        appendLine(item.t, nowStamp(), !!item.v, false);
        installSub.textContent = item.t.replace('…', '');
      }, elapsed - item.d + 120));
    });

    installTimers.push(setTimeout(() => {
      finalizeLog();
      state.installing = false;
      setOrb('success');
      setStateLabel('state.done');
      installTimers.push(setTimeout(() => goTo(4), 850));
    }, total + 260));
  }

  /* ---------------- details toggle ---------------- */
  const detailsToggle = $('#detailsToggle') as HTMLElement;
  detailsToggle.addEventListener('click', () => {
    state.detailsOpen = !state.detailsOpen;
    $$('.log-line.verbose', logBody).forEach((l: any) => {
      l.classList.toggle('hidden-verbose', !state.detailsOpen);
    });
    const label = $('span', detailsToggle) as HTMLElement;
    label.textContent = state.detailsOpen
      ? I18N[state.lang]['install.detailsHide']
      : I18N[state.lang]['install.details'];
  });

  /* ---------------- language ---------------- */
  function applyLang(lang: string) {
    state.lang = lang;
    const dict = I18N[lang];
    const rtl = lang === 'fa';

    document.documentElement.lang = rtl ? 'fa' : 'en';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    windowEl.setAttribute('dir', rtl ? 'rtl' : 'ltr');

    $$('[data-i18n]').forEach((el: any) => {
      const k = el.getAttribute('data-i18n');
      if (dict[k] !== undefined) el.textContent = dict[k];
    });
    $$('[data-i18n-html]').forEach((el: any) => {
      const k = el.getAttribute('data-i18n-html');
      if (dict[k] !== undefined) el.innerHTML = dict[k];
    });

    ($('#langEN') as HTMLElement).classList.toggle('active', !rtl);
    ($('#langFA') as HTMLElement).classList.toggle('active', rtl);

    const label = $('span', detailsToggle) as HTMLElement;
    label.textContent = state.detailsOpen ? dict['install.detailsHide'] : dict['install.details'];

    setStateLabel(
      state.installing ? 'state.installing'
        : state.step === 3 ? 'state.installing'
        : state.step === 4 ? 'state.done' : 'rail.status'
    );
    buildRail();
  }

  ($('#langEN') as HTMLElement).addEventListener('click', () => applyLang('en'));
  ($('#langFA') as HTMLElement).addEventListener('click', () => applyLang('fa'));

  /* ---------------- window controls (real) ---------------- */
  const dotMin = $('.win-dots .dot.min') as HTMLElement;
  const dotClose = $('.win-dots .dot.close') as HTMLElement;
  if (dotMin) dotMin.addEventListener('click', () => (api ? api.minimize() : undefined));
  if (dotClose) dotClose.addEventListener('click', () => (api ? api.close() : window.close()));

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = ((e.target as HTMLElement)?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';

    if (e.key === 'Enter') {
      if (typing && state.step === 2) {
        e.preventDefault();
        void primaryAction();
        return;
      }
      if (!typing) {
        e.preventDefault();
        void primaryAction();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (state.step > 0 && state.step < 3) goTo(state.step - 1);
      else if (state.step === 3) return;
      else if (state.step === 4) goTo(0);
      return;
    }

    if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      if (state.step < 2 || state.step === 4) goTo(state.step + 1);
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && e.altKey) {
      e.preventDefault();
      if (state.step > 0 && state.step !== 3) goTo(state.step - 1);
    }
  });

  /* ---------------- responsive fixed-window scaling ---------------- */
  function fitStage() {
    const stage = $('#stage') as HTMLElement;
    // 2.0.6: the window IS the 900×640 panel (no transparent margin, no
    // hint row) — render at exactly 1:1; shrink only as an emergency
    // fallback when the viewport is somehow smaller (dev runs).
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    const scale = Math.min(1, availW / 900, availH / 640);
    stage.style.transform = 'scale(' + (scale > 0 ? scale : 1) + ')';
    stage.style.marginTop = ((scale - 1) * 640 / 2) + 'px';
    stage.style.marginBottom = ((scale - 1) * 640 / 2) + 'px';
  }
  window.addEventListener('resize', fitStage);

  /* ---------------- boot ---------------- */
  buildRail();
  applyLang('en');
  fitStage();
  animateMeters();

  // REAL context — default destination, payload size, free space.
  (async () => {
    if (!api) return;
    try {
      ctx = await api.getContext();
      state.path = ctx.defaultDir;
      pathInput.value = ctx.defaultDir;
      const chip = $('.ver-chip');
      if (chip) chip.innerHTML = '<span class="d"></span>SETUP v' + ctx.setupVersion;
      const tbVer = $('.tb-ver');
      if (tbVer) tbVer.textContent = 'EPODONIOS · MEMENTO v' + ctx.appVersion + ' · x64';
      await refreshPathStats();
      animateMeters();
    } catch { /* stay on design defaults */ }
  })();

  // lucide icons — same stroke weight as the design call.
  (window as any).lucideCreateIcons = () =>
    Lucide.createIcons({ icons: ALL_ICONS, attrs: { 'stroke-width': 1.9 }, nameAttr: 'data-lucide' } as any);
  (window as any).lucideCreateIcons();
})();
