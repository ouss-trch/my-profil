// تطبيق الثيم واللغة قبل رسم الصفحة لتفادي الوميض (ملف منفصل حتى تبقى سياسة CSP صارمة)
(function () {
  var d = document.documentElement;
  try {
    var t = localStorage.getItem('erp.theme') || 'dark';
    var l = localStorage.getItem('erp.lang') || 'ar';
    if (t === 'dark') d.classList.add('dark');
    d.lang = l;
    d.dir = l === 'ar' ? 'rtl' : 'ltr';
  } catch (e) {
    d.classList.add('dark');
  }
})();
