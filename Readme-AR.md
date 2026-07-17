# <div align="center">MEMENTO</div>
### <div align="center">من EPODONIOS إلى A Who</div>

<div align="center">

![MEMENTO](https://img.shields.io/badge/MEMENTO-V2Ray%20Editor-22c55e?style=for-the-badge&logo=eye)
![Version](https://img.shields.io/badge/version-2.0.0-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey?style=flat-square)
![Tauri](https://img.shields.io/badge/Tauri-v2-24c8db?style=flat-square)

**أقوى وأجمل وأغنى مدير إعدادات V2Ray**

**الكل في واحد • لا حاجة لتحميل إضافي • xray-core مضمن بالداخل**

[English](./README.md) | [فارسی](./README_FA.md) | [العربية](./README_AR.md) | [中文](./README_ZH.md)

</div>

---

> ### ❤️ إهداء
> *أهدي هذا البرنامج إلى A Who. رغم أنني لم أعد أملكها، إلا أنها علمتني ما هو الحب. إذا أحببتم، يمكنكم الانضمام إلى قناتي على تيليجرام – قد تجدون بعض التسلية.*
>
> تيليجرام: **https://t.me/+NqWGD5-OGv1jOGU8** | البريد: **Epodonios@gmail.com**


## تبرع❤️
**USDT (TRC20):**
```
TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT
```


**Tron:**
```
TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT
```


**BTC (TRC20):**
```
TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT
```

---


## ✨ نظرة سريعة على الميزات

### 📥 الاستيراد – إدخال شامل
- اللصق من النص، الحافظة، ملف `.txt`، **رابط اشتراك** (مع 4 بروكسيات احتياطية)
- كشف تلقائي لقوائم Base64
- منع التكرار (نفس الرابط لا يضاف مرتين)
- حد أقصى: **2000 إعداد لكل مصدر** – يمنع تجميد الواجهة
- إضافة مباشرة إلى **مجموعة اشتراك** عبر نافذة جميلة

### 📊 جدول الإعدادات – قلب MEMENTO
- عرض جدول محسن لـ Split View (إخفاء العنوان/الحالة في النوافذ الضيقة)
- بحث، تصفية (الكل / صالح / غير صالح / البروتوكول)، ترتيب حسب الاسم/البروتوكول/العنوان/المنفذ/**البينج**
- تحديد متعدد – **تفاعلات جديدة:**
  - سحب بالماوس لأعلى/أسفل لتحديد نطاق
  - `Shift + Click` + عجلة الماوس لتوسيع التحديد
  - `Ctrl + C` على الصفوف المحددة = نسخ + إشعار
  - `Ctrl + V` عندما تكون علامة تبويب مجموعة نشطة = لصق مباشرة في تلك المجموعة
  - `Enter` على صف = اتصال VPN فوري
- عمود **البينج** المضمن مع شارة ملونة (🟢 <100ms / 🟡 100-300ms / 🔴 >300ms)
- **زر ⚡ Ping** – بينج TCP سريع عبر Rust (`tokio::TcpStream` مثل v2rayN) – مئات الإعدادات في ثانية أو ثانيتين
- **زر الاتصال السريع 🔌** في كل صف
- توسيع الصف لرؤية التفاصيل الكاملة (UUID، SNI، Host، Path، Flow، إلخ)
- **قائمة المشاركة:** Hover على Share → نسخ Base64 / QR Code جميل
- تبويبات **مجموعات الاشتراك** + زر 🔄 تحديث (فقط إذا كان هناك رابط)
- زر **Brokers:** مستودعات منسقة (Epodonios، 0xRadikal، Argh94، Alirewa، iboxz، cbusifabcap) – ينشئ مجموعات `Broker • Name • Item` تلقائياً

### 🔐 اتصال VPN – شبكة خاصة حقيقية
- **لا حاجة لتثبيت xray يدوياً!** 5 أولويات بحث، إذا لم يوجد، يتم تنزيله تلقائياً من GitHub عند أول اتصال (~15MB لمرة واحدة)
- تبديل بروكسي النظام: SOCKS5 + HTTP، عبر سجل Windows
- بطاقة حالة حية، عداد وقت التشغيل، سجل مباشر من xray-core، إحصائيات رفع/تنزيل حقيقية عبر `xray api statsquery`
- **Auto Failover:** إذا انقطع الاتصال، ينتقل تلقائياً إلى أفضل مرشح (نفس المجموعة أو الكل، نفس المنفذ اختياري)
- زر **Spoofing Patt** – تشغيل الأداة المجمعة كمسؤول عبر `Start-Process -Verb RunAs`

### 🎨 المحرر – إعادة كتابة جماعية
- **وضع IP Range:** استنساخ الإعدادات عبر CIDR (`104.16.0.0/24`) أو نطاق شرطي
- **وضع Spoof:** IP/Host + منفذ جديد – يحافظ على UUID و TLS

### ⚡ اختبار البينج و ماسح IP
- نتائج متدفقة، حالة محفوظة (localStorage)

### 📦 التصدير – فلاتر متقدمة متعددة الاختيار (جديد)
- الصيغ: Raw، Base64، JSON، Clash Meta، Surge، Sing-Box
- نطاق مجموعة الاشتراك، فلاتر النقل/المنفذ/البروتوكول/البينج (متعدد)، عداد مباشر `X / Y`
- إعادة تسمية جماعية: `%i%` مدعوم

### 👁️ واجهة سطح مكتب مخصصة
- شريط عنوان مخصص بدون زخرفة، قابل للسحب، أيقونات Min/Max/Close بثيم MEMENTO
- مؤشر أبيض مخصص (SVG)، لا قائمة كليك يمين (إلا في الحقول)

---
## 🚀 التثبيت والبدء السريع

### للمستخدم النهائي
1. حمل `memento.exe` من [Releases](../../releases)
2. شغله – xray-core موجود بالداخل
3. اذهب إلى VPN Connection → اختر إعداد → Connect

##
## 🧠 التقنية المستخدمة
- Frontend: React 19 + TypeScript + Vite 7 + Tailwind CSS 4
- State: Zustand
- Desktop: Tauri v2 (Rust)
- Core: Xray-core v25.1.1
- Ping Engine: Rust tokio::TcpStream batch (64 متزامن)

---

## 🔍 كيف يعمل البينج
- في **.exe**: `TcpStream::connect(host:port)` حقيقي – مثل v2rayN
- في **المتصفح**: WebSocket `ws://host:port` – مصافحة TCP حقيقية
- لوضع Spoof `127.0.0.1:40443`: أي مصافحة >1ms = نجاح

---

## 📬 تواصل معي
- تيليجرام: https://t.me/+NqWGD5-OGv1jOGU8
- البريد: Epodonios@gmail.com

## 📄 الترخيص MIT
