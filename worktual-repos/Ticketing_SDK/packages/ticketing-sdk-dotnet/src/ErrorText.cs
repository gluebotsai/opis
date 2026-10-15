using System.Text.RegularExpressions;

namespace Worktual.Ticketing;

/// <summary>Partner error sentences. Keep this table aligned with the TypeScript client.</summary>
internal static class SdkErrorText
{
    private static readonly Regex LanguageRe = new("^[a-z]{2,3}$", RegexOptions.CultureInvariant);

    private static readonly Dictionary<string, Dictionary<string, string>> Text = new()
    {
        ["auth_required"] = Row(
            "Sign in to continue.",
            "Inicia sesión para continuar.",
            "Connectez-vous pour continuer.",
            "Melden Sie sich an, um fortzufahren.",
            "Inicie sessão para continuar.",
            "जारी रखने के लिए साइन इन करें.",
            "سجّل الدخول للمتابعة."),
        ["session_expired"] = Row(
            "Session expired. Please sign in again.",
            "La sesión expiró. Vuelve a iniciar sesión.",
            "La session a expiré. Veuillez vous reconnecter.",
            "Die Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
            "A sessão expirou. Inicie sessão novamente.",
            "सत्र समाप्त हो गया. कृपया फिर से साइन इन करें.",
            "انتهت الجلسة. يُرجى تسجيل الدخول مرة أخرى."),
        ["forbidden"] = Row(
            "This role cannot run this skill.",
            "Este rol no puede ejecutar esta habilidad.",
            "Ce rôle ne peut pas exécuter cette compétence.",
            "Diese Rolle kann diese Fähigkeit nicht ausführen.",
            "Esta função não pode executar esta competência.",
            "यह भूमिका यह कौशल नहीं चला सकती.",
            "لا يمكن لهذا الدور تشغيل هذه المهارة."),
        ["quota_exceeded"] = Row(
            "This workspace has reached its AI turn limit. Try again shortly.",
            "Este espacio alcanzó el límite de turnos de IA. Inténtalo de nuevo en un momento.",
            "Cet espace a atteint sa limite de tours d'IA. Réessayez dans un instant.",
            "Dieser Arbeitsbereich hat das KI-Turn-Limit erreicht. Bitte kurz warten und erneut versuchen.",
            "Este espaço atingiu o limite de turnos de IA. Tente novamente em instantes.",
            "यह कार्यक्षेत्र AI टर्न सीमा तक पहुँच गया है. थोड़ी देर बाद फिर कोशिश करें.",
            "بلغ هذا النطاق حد أدوار الذكاء الاصطناعي. أعد المحاولة بعد قليل."),
        ["customer_not_found"] = Row(
            "No matching customer was found.",
            "No se encontró un cliente coincidente.",
            "Aucun client correspondant n'a été trouvé.",
            "Es wurde kein passender Kunde gefunden.",
            "Nenhum cliente correspondente foi encontrado.",
            "कोई मेल खाता ग्राहक नहीं मिला.",
            "لم يُعثر على عميل مطابق."),
        ["ticketing_not_purchased"] = Row(
            "This organization has not purchased Ticketing.",
            "Esta organización no ha adquirido Ticketing.",
            "Cette organisation n'a pas acheté Ticketing.",
            "Diese Organisation hat Ticketing nicht erworben.",
            "Esta organização não adquiriu o Ticketing.",
            "इस संगठन ने Ticketing नहीं खरीदा है.",
            "لم تشترِ هذه المؤسسة Ticketing."),
        ["missing_context"] = Row(
            "A ticket is required for this skill.",
            "Se requiere un ticket para esta habilidad.",
            "Un ticket est requis pour cette compétence.",
            "Für diese Fähigkeit ist ein Ticket erforderlich.",
            "É necessário um ticket para esta competência.",
            "इस कौशल के लिए एक टिकट ज़रूरी है.",
            "هذه المهارة تتطلب تذكرة."),
        ["temporarily_unavailable"] = Row(
            "This answer is temporarily unavailable.",
            "Esta respuesta no está disponible por el momento.",
            "Cette réponse est temporairement indisponible.",
            "Diese Antwort ist vorübergehend nicht verfügbar.",
            "Esta resposta está temporariamente indisponível.",
            "यह उत्तर कुछ समय के लिए उपलब्ध नहीं है.",
            "هذه الإجابة غير متاحة مؤقتاً."),
        ["unsupported_operation"] = Row(
            "This request is not supported.",
            "Esta solicitud no está admitida.",
            "Cette demande n'est pas prise en charge.",
            "Diese Anfrage wird nicht unterstützt.",
            "Este pedido não é suportado.",
            "यह अनुरोध समर्थित नहीं है.",
            "هذا الطلب غير مدعوم."),
    };

    private static Dictionary<string, string> Row(string en, string es, string fr, string de, string pt, string hi, string ar) =>
        new()
        {
            ["en"] = en,
            ["es"] = es,
            ["fr"] = fr,
            ["de"] = de,
            ["pt"] = pt,
            ["hi"] = hi,
            ["ar"] = ar,
        };

    public static string? StableCode(object? value)
    {
        var code = (value as string ?? "").Trim();
        if (code == "unsupported_product") return "unsupported_operation";
        return Text.ContainsKey(code) ? code : null;
    }

    public static string? Message(string code, string? locale)
    {
        if (!Text.TryGetValue(code, out var table)) return null;
        var lang = Language(locale);
        return table.TryGetValue(lang, out var sentence) ? sentence : table["en"];
    }

    private static string Language(string? locale)
    {
        var raw = (locale ?? "en").Trim().ToLowerInvariant();
        var lang = raw.Split('-', '_')[0];
        if (lang.Length == 0) lang = "en";
        return LanguageRe.IsMatch(lang) ? lang : "en";
    }
}
