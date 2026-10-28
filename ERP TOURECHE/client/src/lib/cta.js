// أزرار الدعوة في إعلانات Meta: نص الزر تحدده Meta بحسب النوع ولغة من يشاهد الإعلان، ولا يقبل نصاً حراً.
// الصيغ أدناه تقريبية (ما يراه الزائر بالعربية/الفرنسية)، والعبارة الحرة تُكتب في «العنوان» وتظهر بجانب الزر كما كُتبت.
export const CTA_OPTIONS = [
  { value: 'SHOP_NOW', ar: 'تسوّق الآن', fr: 'Acheter' },
  { value: 'ORDER_NOW', ar: 'اطلب الآن', fr: 'Commander' },
  { value: 'BUY_NOW', ar: 'اشترِ الآن', fr: 'Acheter maintenant' },
  { value: 'LEARN_MORE', ar: 'اعرف المزيد', fr: 'En savoir plus' },
  { value: 'GET_OFFER', ar: 'احصل على العرض', fr: 'Profiter de l’offre' },
  { value: 'SEE_MORE', ar: 'عرض المزيد', fr: 'Voir plus' },
  { value: 'CONTACT_US', ar: 'اتصل بنا', fr: 'Nous contacter' },
  { value: 'BOOK_NOW', ar: 'احجز الآن', fr: 'Réserver' },
  { value: 'GET_QUOTE', ar: 'احصل على عرض سعر', fr: 'Demander un devis' },
  { value: 'SIGN_UP', ar: 'سجّل', fr: 'S’inscrire' },
  { value: 'SUBSCRIBE', ar: 'اشترك', fr: 'S’abonner' },
  { value: 'WATCH_MORE', ar: 'شاهد المزيد', fr: 'Voir plus de vidéos' },
  { value: 'NO_BUTTON', ar: 'بلا زر', fr: 'Sans bouton' },
];

/** كل أنواع Meta (الإصدار 26) للإكمال التلقائي عند كتابة نوع آخر */
export const CTA_CODES = `OPEN_LINK LIKE_PAGE SHOP_NOW PLAY_GAME INSTALL_APP USE_APP CALL CALL_ME VIDEO_CALL INSTALL_MOBILE_APP USE_MOBILE_APP MOBILE_DOWNLOAD BOOK_TRAVEL LISTEN_MUSIC WATCH_VIDEO LEARN_MORE SIGN_UP DOWNLOAD WATCH_MORE NO_BUTTON VISIT_PAGES_FEED CALL_NOW APPLY_NOW CONTACT BUY_NOW GET_OFFER GET_OFFER_VIEW BUY_TICKETS UPDATE_APP GET_DIRECTIONS BUY SEND_UPDATES MESSAGE_PAGE DONATE SUBSCRIBE SAY_THANKS SELL_NOW SHARE DONATE_NOW GET_QUOTE CONTACT_US ORDER_NOW START_ORDER ADD_TO_CART VIEW_CART VIEW_IN_CART VIDEO_ANNOTATION RECORD_NOW INQUIRE_NOW CONFIRM REFER_FRIENDS REQUEST_TIME GET_SHOWTIMES LISTEN_NOW TRY_DEMO WOODHENGE_SUPPORT SOTTO_SUBSCRIBE FOLLOW_USER RAISE_MONEY SEE_SHOP GET_DETAILS FIND_OUT_MORE VISIT_WEBSITE BROWSE_SHOP EVENT_RSVP WHATSAPP_MESSAGE FOLLOW_NEWS_STORYLINE SEE_MORE BOOK_NOW FIND_A_GROUP FIND_YOUR_GROUPS PAY_TO_ACCESS PURCHASE_GIFT_CARDS FOLLOW_PAGE SEND_A_GIFT SWIPE_UP_SHOP SWIPE_UP_PRODUCT SEND_GIFT_MONEY PLAY_GAME_ON_FACEBOOK GET_STARTED OPEN_INSTANT_APP AUDIO_CALL GET_PROMOTIONS JOIN_CHANNEL MAKE_AN_APPOINTMENT ASK_ABOUT_SERVICES BOOK_A_CONSULTATION GET_A_QUOTE BUY_VIA_MESSAGE ASK_FOR_MORE_INFO CHAT_WITH_US VIEW_PRODUCT VIEW_CHANNEL GET_IN_TOUCH ASK_A_QUESTION START_A_CHAT CHAT_NOW ASK_US WATCH_LIVE_VIDEO JOIN_LIVE_VIDEO SHOP_WITH_AI TRY_ON_WITH_AI WATCH_NOW STREAM_NOW BUY_ACTIVITY_TICKETS`.split(' ');

export const ctaLabel = (value, lang) => {
  const o = CTA_OPTIONS.find((x) => x.value === value);
  return o ? (lang === 'ar' ? o.ar : o.fr) : String(value || '').replace(/_/g, ' ');
};
