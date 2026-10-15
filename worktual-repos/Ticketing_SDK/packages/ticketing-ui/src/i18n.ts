export type ChatStrings = {
  placeholder: string;
  send: string;
  confirm: string;
  reject: string;
  thinking: string;
  confirmTitle: string;
  missingAuth: string;
  poweredBy: string;
};

const EN: ChatStrings = {
  placeholder: "Ask the assistant…",
  send: "Send",
  confirm: "Confirm",
  reject: "Reject",
  thinking: "Working…",
  confirmTitle: "Confirm this action",
  missingAuth: "A session token and endpoint are required.",
  poweredBy: "AI powered by Worktual",
};

const PACKS: Record<string, ChatStrings> = {
  en: EN,
  es: {
    placeholder: "Pregunta al asistente…",
    send: "Enviar",
    confirm: "Confirmar",
    reject: "Rechazar",
    thinking: "Trabajando…",
    confirmTitle: "Confirma esta acción",
    missingAuth: "Se necesitan un token de sesión y un endpoint.",
    poweredBy: "IA de Worktual",
  },
  fr: {
    placeholder: "Demandez à l’assistant…",
    send: "Envoyer",
    confirm: "Confirmer",
    reject: "Refuser",
    thinking: "En cours…",
    confirmTitle: "Confirmer cette action",
    missingAuth: "Un jeton de session et un endpoint sont requis.",
    poweredBy: "IA propulsée par Worktual",
  },
  de: {
    placeholder: "Fragen Sie den Assistenten…",
    send: "Senden",
    confirm: "Bestätigen",
    reject: "Ablehnen",
    thinking: "Arbeitet…",
    confirmTitle: "Diese Aktion bestätigen",
    missingAuth: "Sitzungstoken und Endpunkt sind erforderlich.",
    poweredBy: "KI von Worktual",
  },
  pt: {
    placeholder: "Pergunte ao assistente…",
    send: "Enviar",
    confirm: "Confirmar",
    reject: "Recusar",
    thinking: "A trabalhar…",
    confirmTitle: "Confirme esta ação",
    missingAuth: "É necessário um token de sessão e um endpoint.",
    poweredBy: "IA da Worktual",
  },
  hi: {
    placeholder: "सहायक से पूछें…",
    send: "भेजें",
    confirm: "पुष्टि करें",
    reject: "अस्वीकार करें",
    thinking: "काम हो रहा है…",
    confirmTitle: "इस कार्रवाई की पुष्टि करें",
    missingAuth: "सेशन टोकन और एंडपॉइंट ज़रूरी हैं।",
    poweredBy: "Worktual द्वारा AI",
  },
  ar: {
    placeholder: "اسأل المساعد…",
    send: "إرسال",
    confirm: "تأكيد",
    reject: "رفض",
    thinking: "جارٍ العمل…",
    confirmTitle: "أكّد هذا الإجراء",
    missingAuth: "يلزم رمز الجلسة وعنوان نقطة الاتصال.",
    poweredBy: "ذكاء اصطناعي من Worktual",
  },
};

export type TaskStrings = {
  run: string;
  send: string;
  confirm: string;
  reject: string;
  working: string;
  missingAuth: string;
  missingTicket: string;
  missingIssue: string;
  draftLabel: string;
  titles: {
    summarize: string;
    classify: string;
    draftReply: string;
    similar: string;
    kb: string;
    deflect: string;
    create: string;
    assign: string;
    resolve: string;
    quality: string;
    sla: string;
    workload: string;
  };
};

const TASK_EN: TaskStrings = {
  run: "Run",
  send: "Send",
  confirm: "Confirm",
  reject: "Reject",
  working: "Working…",
  missingAuth: "A session token and endpoint are required.",
  missingTicket: "Choose a ticket first.",
  missingIssue: "Describe the issue first.",
  draftLabel: "Reply draft",
  titles: {
    summarize: "Summary",
    classify: "Classify",
    draftReply: "Reply draft",
    similar: "Similar tickets",
    kb: "Suggested articles",
    deflect: "Before a ticket",
    create: "New ticket",
    assign: "Assign",
    resolve: "Resolve",
    quality: "Quality",
    sla: "SLA",
    workload: "Workload",
  },
};

const TASK_PACKS: Record<string, TaskStrings> = {
  en: TASK_EN,
  es: {
    ...TASK_EN,
    run: "Ejecutar",
    send: "Enviar",
    confirm: "Confirmar",
    reject: "Rechazar",
    working: "Trabajando…",
    missingAuth: "Se necesitan un token de sesión y un endpoint.",
    missingTicket: "Elige un ticket primero.",
    missingIssue: "Describe el problema primero.",
    draftLabel: "Borrador de respuesta",
    titles: {
      summarize: "Resumen",
      classify: "Clasificar",
      draftReply: "Borrador de respuesta",
      similar: "Tickets similares",
      kb: "Artículos sugeridos",
      deflect: "Antes de crear un ticket",
      create: "Ticket nuevo",
      assign: "Asignar",
      resolve: "Resolver",
      quality: "Calidad",
      sla: "SLA",
      workload: "Carga",
    },
  },
  fr: {
    ...TASK_EN,
    run: "Lancer",
    send: "Envoyer",
    confirm: "Confirmer",
    reject: "Refuser",
    working: "En cours…",
    titles: {
      summarize: "Résumé",
      classify: "Classer",
      draftReply: "Brouillon de réponse",
      similar: "Tickets similaires",
      kb: "Articles suggérés",
      deflect: "Avant un ticket",
      create: "Nouveau ticket",
      assign: "Assigner",
      resolve: "Résoudre",
      quality: "Qualité",
      sla: "SLA",
      workload: "Charge",
    },
  },
  de: {
    ...TASK_EN,
    run: "Starten",
    send: "Senden",
    confirm: "Bestätigen",
    reject: "Ablehnen",
    working: "Arbeitet…",
    titles: {
      summarize: "Zusammenfassung",
      classify: "Klassifizieren",
      draftReply: "Antwortentwurf",
      similar: "Ähnliche Tickets",
      kb: "Vorgeschlagene Artikel",
      deflect: "Vor einem Ticket",
      create: "Neues Ticket",
      assign: "Zuweisen",
      resolve: "Lösen",
      quality: "Qualität",
      sla: "SLA",
      workload: "Auslastung",
    },
  },
  pt: {
    ...TASK_EN,
    run: "Executar",
    send: "Enviar",
    confirm: "Confirmar",
    reject: "Recusar",
    working: "A trabalhar…",
    titles: {
      summarize: "Resumo",
      classify: "Classificar",
      draftReply: "Rascunho de resposta",
      similar: "Tickets semelhantes",
      kb: "Artigos sugeridos",
      deflect: "Antes de um ticket",
      create: "Novo ticket",
      assign: "Atribuir",
      resolve: "Resolver",
      quality: "Qualidade",
      sla: "SLA",
      workload: "Carga",
    },
  },
  hi: {
    ...TASK_EN,
    run: "चलाएँ",
    send: "भेजें",
    confirm: "पुष्टि करें",
    reject: "अस्वीकार करें",
    working: "काम हो रहा है…",
    titles: {
      summarize: "सारांश",
      classify: "वर्गीकृत करें",
      draftReply: "उत्तर का मसौदा",
      similar: "मिलते-जुलते टिकट",
      kb: "सुझाए लेख",
      deflect: "टिकट से पहले",
      create: "नया टिकट",
      assign: "असाइन",
      resolve: "हल करें",
      quality: "गुणवत्ता",
      sla: "SLA",
      workload: "कार्यभार",
    },
  },
  ar: {
    ...TASK_EN,
    run: "تشغيل",
    send: "إرسال",
    confirm: "تأكيد",
    reject: "رفض",
    working: "جارٍ العمل…",
    titles: {
      summarize: "ملخص",
      classify: "تصنيف",
      draftReply: "مسودة الرد",
      similar: "تذاكر مشابهة",
      kb: "مقالات مقترحة",
      deflect: "قبل إنشاء تذكرة",
      create: "تذكرة جديدة",
      assign: "تعيين",
      resolve: "حل",
      quality: "الجودة",
      sla: "اتفاقية الخدمة",
      workload: "الحمل",
    },
  },
};

export function taskStrings(locale: string, overrides?: Partial<TaskStrings> | null): TaskStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = TASK_PACKS[lang] || TASK_EN;
  return {
    ...pack,
    ...(overrides || {}),
    titles: { ...pack.titles, ...(overrides?.titles || {}) },
  };
}

export type ApprovalStrings = {
  title: string;
  empty: string;
  confirm: string;
  reject: string;
  working: string;
  missingAuth: string;
  recommendation: string;
};

const APPROVAL_EN: ApprovalStrings = {
  title: "Approvals",
  empty: "Nothing is waiting.",
  confirm: "Confirm",
  reject: "Reject",
  working: "Working…",
  missingAuth: "A session token and endpoint are required.",
  recommendation: "Recommendation",
};

const APPROVAL_PACKS: Record<string, ApprovalStrings> = {
  en: APPROVAL_EN,
  es: {
    title: "Aprobaciones",
    empty: "No hay nada pendiente.",
    confirm: "Confirmar",
    reject: "Rechazar",
    working: "Trabajando…",
    missingAuth: "Se necesitan un token de sesión y un endpoint.",
    recommendation: "Recomendación",
  },
  ar: {
    title: "الموافقات",
    empty: "لا يوجد شيء بانتظارك.",
    confirm: "تأكيد",
    reject: "رفض",
    working: "جارٍ العمل…",
    missingAuth: "يلزم رمز الجلسة وعنوان نقطة الاتصال.",
    recommendation: "توصية",
  },
};

export function approvalStrings(locale: string, overrides?: Partial<ApprovalStrings> | null): ApprovalStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = APPROVAL_PACKS[lang] || APPROVAL_EN;
  return { ...pack, ...(overrides || {}) };
}

export type InsightStrings = {
  title: string;
  placeholder: string;
  metrics: string;
  why: string;
  tickets: string;
  missingAuth: string;
  missingQuestion: string;
  unavailable: string;
};

const INSIGHT_EN: InsightStrings = {
  title: "Insights",
  placeholder: "Ask about volume, CSAT, or SLA…",
  metrics: "Metrics",
  why: "Why",
  tickets: "Tickets",
  missingAuth: "A session token and endpoint are required.",
  missingQuestion: "Ask a question first.",
  unavailable: "This answer is temporarily unavailable.",
};

const INSIGHT_PACKS: Record<string, InsightStrings> = {
  en: INSIGHT_EN,
  es: {
    title: "Indicadores",
    placeholder: "Pregunta por volumen, CSAT o SLA…",
    metrics: "Métricas",
    why: "Por qué",
    tickets: "Tickets",
    missingAuth: "Se necesitan un token de sesión y un endpoint.",
    missingQuestion: "Haz una pregunta primero.",
    unavailable: "Esta respuesta no está disponible por ahora.",
  },
  ar: {
    title: "المؤشرات",
    placeholder: "اسأل عن الحجم أو الرضا أو اتفاقية الخدمة…",
    metrics: "المقاييس",
    why: "لماذا",
    tickets: "التذاكر",
    missingAuth: "يلزم رمز الجلسة وعنوان نقطة الاتصال.",
    missingQuestion: "اطرح سؤالاً أولاً.",
    unavailable: "هذه الإجابة غير متاحة مؤقتاً.",
  },
};

export function insightStrings(locale: string, overrides?: Partial<InsightStrings> | null): InsightStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = INSIGHT_PACKS[lang] || INSIGHT_EN;
  return { ...pack, ...(overrides || {}) };
}

const RTL = new Set(["ar", "he", "fa", "ur"]);

export function localeDir(locale: string): "rtl" | "ltr" {
  const lang = locale.toLowerCase().split("-")[0];
  return RTL.has(lang) ? "rtl" : "ltr";
}

export function chatStrings(locale: string, overrides?: Partial<ChatStrings> | null): ChatStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = PACKS[lang] || EN;
  return { ...pack, ...(overrides || {}) };
}

export type LauncherStrings = {
  open: string;
  close: string;
  title: string;
};

const LAUNCHER_EN: LauncherStrings = {
  open: "Open chat",
  close: "Close chat",
  title: "Worktual assistant",
};

const LAUNCHER_PACKS: Record<string, LauncherStrings> = {
  en: LAUNCHER_EN,
  es: { open: "Abrir chat", close: "Cerrar chat", title: "Asistente de Worktual" },
  fr: { open: "Ouvrir le chat", close: "Fermer le chat", title: "Assistant Worktual" },
  de: { open: "Chat öffnen", close: "Chat schließen", title: "Worktual-Assistent" },
  pt: { open: "Abrir chat", close: "Fechar chat", title: "Assistente Worktual" },
  hi: { open: "चैट खोलें", close: "चैट बंद करें", title: "Worktual सहायक" },
  ar: { open: "افتح المحادثة", close: "أغلق المحادثة", title: "مساعد Worktual" },
};

export function launcherStrings(locale: string, overrides?: Partial<LauncherStrings> | null): LauncherStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = LAUNCHER_PACKS[lang] || LAUNCHER_EN;
  return { ...pack, ...(overrides || {}) };
}

export type LoginStrings = {
  staffTitle: string;
  portalTitle: string;
  email: string;
  password: string;
  identifier: string;
  code: string;
  slug: string;
  signIn: string;
  sendCode: string;
  verify: string;
  working: string;
  missing: string;
  sent: string;
};

const LOGIN_EN: LoginStrings = {
  staffTitle: "Staff sign in",
  portalTitle: "Support portal",
  email: "Email",
  password: "Password",
  identifier: "Email or phone",
  code: "Code",
  slug: "Portal",
  signIn: "Sign in",
  sendCode: "Send code",
  verify: "Verify",
  working: "Working…",
  missing: "Fill in the required fields.",
  sent: "Code sent",
};

const LOGIN_PACKS: Record<string, LoginStrings> = {
  en: LOGIN_EN,
  es: {
    ...LOGIN_EN,
    staffTitle: "Acceso del equipo",
    portalTitle: "Portal de soporte",
    email: "Correo",
    password: "Contraseña",
    identifier: "Correo o teléfono",
    code: "Código",
    slug: "Portal",
    signIn: "Entrar",
    sendCode: "Enviar código",
    verify: "Verificar",
    working: "Trabajando…",
    missing: "Completa los campos obligatorios.",
    sent: "Código enviado",
  },
  ar: {
    ...LOGIN_EN,
    staffTitle: "دخول الموظفين",
    portalTitle: "بوابة الدعم",
    email: "البريد",
    password: "كلمة المرور",
    identifier: "البريد أو الهاتف",
    code: "الرمز",
    slug: "البوابة",
    signIn: "دخول",
    sendCode: "إرسال الرمز",
    verify: "تحقق",
    working: "جارٍ العمل…",
    missing: "أكمل الحقول المطلوبة.",
    sent: "تم إرسال الرمز",
  },
  fr: {
    ...LOGIN_EN,
    staffTitle: "Connexion du personnel",
    portalTitle: "Portail d'assistance",
    email: "E-mail",
    password: "Mot de passe",
    identifier: "E-mail ou téléphone",
    code: "Code",
    slug: "Portail",
    signIn: "Se connecter",
    sendCode: "Envoyer le code",
    verify: "Vérifier",
    working: "Traitement…",
    missing: "Remplissez les champs obligatoires.",
    sent: "Code envoyé",
  },
  de: {
    ...LOGIN_EN,
    staffTitle: "Mitarbeiteranmeldung",
    portalTitle: "Support-Portal",
    email: "E-Mail",
    password: "Passwort",
    identifier: "E-Mail oder Telefon",
    code: "Code",
    slug: "Portal",
    signIn: "Anmelden",
    sendCode: "Code senden",
    verify: "Prüfen",
    working: "Wird ausgeführt…",
    missing: "Füllen Sie die Pflichtfelder aus.",
    sent: "Code gesendet",
  },
  pt: {
    ...LOGIN_EN,
    staffTitle: "Acesso da equipe",
    portalTitle: "Portal de suporte",
    email: "E-mail",
    password: "Senha",
    identifier: "E-mail ou telefone",
    code: "Código",
    slug: "Portal",
    signIn: "Entrar",
    sendCode: "Enviar código",
    verify: "Verificar",
    working: "Aguarde…",
    missing: "Preencha os campos obrigatórios.",
    sent: "Código enviado",
  },
  hi: {
    ...LOGIN_EN,
    staffTitle: "स्टाफ साइन इन",
    portalTitle: "सहायता पोर्टल",
    email: "ईमेल",
    password: "पासवर्ड",
    identifier: "ईमेल या फ़ोन",
    code: "कोड",
    slug: "पोर्टल",
    signIn: "साइन इन",
    sendCode: "कोड भेजें",
    verify: "सत्यापित करें",
    working: "जारी है…",
    missing: "आवश्यक फ़ील्ड भरें.",
    sent: "कोड भेज दिया गया",
  },
};

export function loginStrings(locale: string, overrides?: Partial<LoginStrings> | null): LoginStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = LOGIN_PACKS[lang] || LOGIN_EN;
  return { ...pack, ...(overrides || {}) };
}

export type InboxStrings = {
  title: string;
  empty: string;
  markAll: string;
  missingAuth: string;
};

const INBOX_EN: InboxStrings = {
  title: "Notifications",
  empty: "No notifications.",
  markAll: "Mark all read",
  missingAuth: "A session token and endpoint are required.",
};

const INBOX_PACKS: Record<string, InboxStrings> = {
  en: INBOX_EN,
  es: {
    title: "Avisos",
    empty: "No hay avisos.",
    markAll: "Marcar todo como leído",
    missingAuth: "Se necesitan un token de sesión y un endpoint.",
  },
  ar: {
    title: "الإشعارات",
    empty: "لا توجد إشعارات.",
    markAll: "تعليم الكل كمقروء",
    missingAuth: "يلزم رمز الجلسة وعنوان نقطة الاتصال.",
  },
  fr: {
    title: "Notifications",
    empty: "Aucune notification.",
    markAll: "Tout marquer comme lu",
    missingAuth: "Un jeton de session et un endpoint sont requis.",
  },
  de: {
    title: "Benachrichtigungen",
    empty: "Keine Benachrichtigungen.",
    markAll: "Alle als gelesen markieren",
    missingAuth: "Sitzungstoken und Endpunkt sind erforderlich.",
  },
  pt: {
    title: "Notificações",
    empty: "Nenhuma notificação.",
    markAll: "Marcar todas como lidas",
    missingAuth: "São necessários um token de sessão e um endpoint.",
  },
  hi: {
    title: "सूचनाएँ",
    empty: "कोई सूचना नहीं.",
    markAll: "सभी को पढ़ा हुआ चिह्नित करें",
    missingAuth: "सेशन टोकन और एंडपॉइंट ज़रूरी हैं.",
  },
};

export function inboxStrings(locale: string, overrides?: Partial<InboxStrings> | null): InboxStrings {
  const lang = locale.toLowerCase().split("-")[0] || "en";
  const pack = INBOX_PACKS[lang] || INBOX_EN;
  return { ...pack, ...(overrides || {}) };
}
