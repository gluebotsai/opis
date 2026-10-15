/** Partner error sentences. Keep this table aligned with ui-backend sdkTasks.ts. */

const TEXT: Record<string, Record<string, string>> = {
  auth_required: {
    en: "Sign in to continue.",
    es: "Inicia sesión para continuar.",
    fr: "Connectez-vous pour continuer.",
    de: "Melden Sie sich an, um fortzufahren.",
    pt: "Inicie sessão para continuar.",
    hi: "जारी रखने के लिए साइन इन करें.",
    ar: "سجّل الدخول للمتابعة.",
  },
  session_expired: {
    en: "Session expired. Please sign in again.",
    es: "La sesión expiró. Vuelve a iniciar sesión.",
    fr: "La session a expiré. Veuillez vous reconnecter.",
    de: "Die Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
    pt: "A sessão expirou. Inicie sessão novamente.",
    hi: "सत्र समाप्त हो गया. कृपया फिर से साइन इन करें.",
    ar: "انتهت الجلسة. يُرجى تسجيل الدخول مرة أخرى.",
  },
  forbidden: {
    en: "This role cannot run this skill.",
    es: "Este rol no puede ejecutar esta habilidad.",
    fr: "Ce rôle ne peut pas exécuter cette compétence.",
    de: "Diese Rolle kann diese Fähigkeit nicht ausführen.",
    pt: "Esta função não pode executar esta competência.",
    hi: "यह भूमिका यह कौशल नहीं चला सकती.",
    ar: "لا يمكن لهذا الدور تشغيل هذه المهارة.",
  },
  quota_exceeded: {
    en: "This workspace has reached its AI turn limit. Try again shortly.",
    es: "Este espacio alcanzó el límite de turnos de IA. Inténtalo de nuevo en un momento.",
    fr: "Cet espace a atteint sa limite de tours d'IA. Réessayez dans un instant.",
    de: "Dieser Arbeitsbereich hat das KI-Turn-Limit erreicht. Bitte kurz warten und erneut versuchen.",
    pt: "Este espaço atingiu o limite de turnos de IA. Tente novamente em instantes.",
    hi: "यह कार्यक्षेत्र AI टर्न सीमा तक पहुँच गया है. थोड़ी देर बाद फिर कोशिश करें.",
    ar: "بلغ هذا النطاق حد أدوار الذكاء الاصطناعي. أعد المحاولة بعد قليل.",
  },
  customer_not_found: {
    en: "No matching customer was found.",
    es: "No se encontró un cliente coincidente.",
    fr: "Aucun client correspondant n'a été trouvé.",
    de: "Es wurde kein passender Kunde gefunden.",
    pt: "Nenhum cliente correspondente foi encontrado.",
    hi: "कोई मेल खाता ग्राहक नहीं मिला.",
    ar: "لم يُعثر على عميل مطابق.",
  },
  ticketing_not_purchased: {
    en: "This organization has not purchased Ticketing.",
    es: "Esta organización no ha adquirido Ticketing.",
    fr: "Cette organisation n'a pas acheté Ticketing.",
    de: "Diese Organisation hat Ticketing nicht erworben.",
    pt: "Esta organização não adquiriu o Ticketing.",
    hi: "इस संगठन ने Ticketing नहीं खरीदा है.",
    ar: "لم تشترِ هذه المؤسسة Ticketing.",
  },
  missing_context: {
    en: "A ticket is required for this skill.",
    es: "Se requiere un ticket para esta habilidad.",
    fr: "Un ticket est requis pour cette compétence.",
    de: "Für diese Fähigkeit ist ein Ticket erforderlich.",
    pt: "É necessário um ticket para esta competência.",
    hi: "इस कौशल के लिए एक टिकट ज़रूरी है.",
    ar: "هذه المهارة تتطلب تذكرة.",
  },
  temporarily_unavailable: {
    en: "This answer is temporarily unavailable.",
    es: "Esta respuesta no está disponible por el momento.",
    fr: "Cette réponse est temporairement indisponible.",
    de: "Diese Antwort ist vorübergehend nicht verfügbar.",
    pt: "Esta resposta está temporariamente indisponível.",
    hi: "यह उत्तर कुछ समय के लिए उपलब्ध नहीं है.",
    ar: "هذه الإجابة غير متاحة مؤقتاً.",
  },
  unsupported_operation: {
    en: "This request is not supported.",
    es: "Esta solicitud no está admitida.",
    fr: "Cette demande n'est pas prise en charge.",
    de: "Diese Anfrage wird nicht unterstützt.",
    pt: "Este pedido não é suportado.",
    hi: "यह अनुरोध समर्थित नहीं है.",
    ar: "هذا الطلب غير مدعوم.",
  },
};

function language(locale: string | undefined): string {
  const lang = String(locale || "en").trim().toLowerCase().split(/[-_]/)[0] || "en";
  return /^[a-z]{2,3}$/.test(lang) ? lang : "en";
}

export function sdkStableCode(value: unknown): string | null {
  const code = String(value || "").trim();
  if (code === "unsupported_product") return "unsupported_operation";
  return TEXT[code] ? code : null;
}

/** Catalog sentence for a partner code. Unknown codes return null so the caller keeps the server text. */
export function sdkErrorText(code: string, locale?: string): string | null {
  const table = TEXT[code];
  if (!table) return null;
  return table[language(locale)] || table.en;
}
