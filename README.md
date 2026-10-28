# کات — ویدیو ادیتور ریلز (PWA)
ویرایشگر ویدیوی موبایل به سبک CapCut، کاملاً روی دستگاه (هیچ آپلودی). فارسی/RTL، فونت وزیرمتن محلی.

اجرا: هر سرور استاتیک (`python3 -m http.server`). میزبانی: GitHub Pages با مسیرهای نسبی.
تست: `npm test` (واحد) و `PW_DIR=/tmp/pw node tests/e2e.mjs http://127.0.0.1:8833/`.
هنگام هر انتشار، `VERSION` در `sw.js` را بالا ببرید.
کتابخانه‌ها: mp4-muxer (MIT)، transformers.js (Apache-2.0)، Vazirmatn (OFL) — مجوزها در vendor/ و fonts/.
