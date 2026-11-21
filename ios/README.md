# Frostly for iPhone — تجربة أولية

هذا مشروع iOS تجريبي يفتح موقع Frostly الحالي داخل WebView أصلي، مع أيقونة التطبيق، شريط رجوع/تقدم، تحديث ومشاركة، وحفظ تنزيلات الويب ثم مشاركتها إلى تطبيق الملفات أو أي تطبيق آخر.

## استخراج IPA عبر GitHub

1. شغّل سير عمل **Build Frostly iOS IPA** من تبويب Actions، أو ادفع تغييرات فرع `feat/ios-app`.
2. بعد نجاح البناء، نزّل الأثر **Frostly-unsigned-ipa** من صفحة التشغيل.
3. استخدم ملف `Frostly-unsigned.ipa` مع ESign لإعادة توقيعه وتثبيته على جهازك.

الملف الناتج غير موقّع عمدًا؛ لا يمكن تثبيته مباشرة قبل توقيعه. هذا إعداد تجريبي للتثبيت الشخصي، وليس رفعًا إلى App Store أو TestFlight.

## إعداد المشروع

- اسم التطبيق الظاهر: `Frostly`
- Bundle ID الحالي: `com.wahm.frostly`
- أقل إصدار iOS: `16.0`
- رابط الموقع: `https://wahm-social.onrender.com`

إذا غيّرت Bundle ID أثناء التوقيع، استخدم المعرّف نفسه في ملف التعريف/الشهادة ضمن ESign. الموقع نفسه يبقى مستضافًا كما هو؛ لا تُنسخ بيانات البيئة أو مفاتيح الموقع إلى التطبيق أو سجل GitHub.

## بناء محلي على macOS

```sh
brew install xcodegen
xcodegen generate --spec ios/project.yml --project ios
xcodebuild -project ios/Frostly.xcodeproj -scheme Frostly -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

## ملاحظة تسجيل الدخول

تسجيل الدخول بالبريد وكلمة المرور يعمل من صفحة الموقع. قد يحتاج تسجيل Google إلى تكامل مصادقة iOS أصلي إضافي لأن Google لا يدعم بعض تدفقات OAuth داخل WebView؛ هذا التطبيق حاليًا غلاف تجريبي للموقع وليس تطبيقًا أصليًا كاملًا.
