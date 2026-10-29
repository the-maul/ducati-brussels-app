// M0/M10 — Textes des e-mails composés PAR LE SERVEUR (fonctions Edge), en FR / NL / EN / IT
// (I18N004, décision client M-71 du 30/10/2026 : « le client, lui, la reçoit dans sa langue »).
//
// Pourquoi un dictionnaire à part : les fonctions Edge (Deno) sont déployées depuis le dossier
// supabase/functions (dossier _shared inclus) et ne voient pas src/lib/i18n ; les dictionnaires
// de l'application font 4 000 lignes chacun et portent des types React. Ce fichier est PUR
// (aucun accès réseau, aucune dépendance) : il est aussi importé par les tests bun
// (tests/langue-du-client.test.ts) qui vérifient que les quatre langues ont les mêmes clés.
//
// Qui l'utilise :
//   - _shared/mail-message.ts : pied de mail « invitation à l'espace client » (P-5 / P-6) ;
//   - send-account-invitation : bienvenue, invitation, mot de passe modifié, mot de passe oublié ;
//   - graph-send-email : choisit la langue d'après la fiche du destinataire (contacts.locale).
// Règle d'écriture : apostrophes droites, noms propres non traduits (Ducati Bruxelles), FR de
// référence. Les textes FR sont ceux validés par le client (18/09, 19/09, 21/09, 05/10).

export const MAIL_LOCALES = ['fr', 'nl', 'en', 'it'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];
export const DEFAULT_MAIL_LOCALE: MailLocale = 'fr';

export function asMailLocale(value: unknown): MailLocale | null {
  return typeof value === 'string' && (MAIL_LOCALES as readonly string[]).includes(value) ? (value as MailLocale) : null;
}

/**
 * Langue d'un e-mail adressé à une personne : la FICHE du client d'abord (contacts.locale,
 * source unique), sinon son profil de compte (profiles.locale, synchronisé par déclencheur),
 * sinon FR. Pure : testée.
 */
export function pickMailLocale(p: { contactLocale?: unknown; profileLocale?: unknown }): MailLocale {
  return asMailLocale(p.contactLocale) ?? asMailLocale(p.profileLocale) ?? DEFAULT_MAIL_LOCALE;
}

export type MailTexts = {
  /** Pied de mail P-5 / P-6 (mail-message.ts). */
  footer: {
    joinText: string; loginText: string; perks: string; joinNudge: string; loginNudge: string; button: string;
  };
  /** Mails de compte (send-account-invitation). `{name}`, `{email}`, `{host}`, `{when}` remplacés. */
  account: {
    hello: string; helloAnonymous: string;
    welcomeTitle: string; welcomeAccess: string;
    inviteSubjectSignup: string; inviteSubjectClient: string; inviteSubjectStaff: string;
    inviteKnown: string; inviteClient: string; inviteStaff: string;
    inviteChoose: string; inviteLink: string; identifier: string; linkOnce: string;
    inviteIgnoreSignup: string; inviteIgnore: string;
    welcomeSubject: string; welcomeIdentifier: string; welcomeOpen: string; welcomeIgnore: string; welcomeBye: string;
    passwordSubject: string; passwordChanged: string; passwordIfYou: string; passwordIfNot: string; passwordLogin: string; neverPassword: string;
    resetSubject: string; resetIntro: string; resetLink: string; resetExpired: string; resetIgnore: string;
    signature: string;
  };
};

const fr: MailTexts = {
  footer: {
    joinText: 'Retrouvez tous vos documents et le suivi de votre moto grâce à l\'application Ducati Bruxelles.',
    loginText: 'Votre espace Ducati Bruxelles est prêt : tous vos documents et le suivi de votre moto, au même endroit.',
    perks: 'Vos factures, le suivi de vos interventions à l\'atelier, les photos de votre moto, et notre équipe joignable pour toute demande commerciale.',
    joinNudge: 'Pas encore de compte ? Créez-le gratuitement :',
    loginNudge: 'Votre compte vous attend :',
    button: 'Mon espace Ducati Bruxelles',
  },
  account: {
    hello: 'Bonjour {name},', helloAnonymous: 'Bonjour,',
    welcomeTitle: 'Bravo et merci pour votre enregistrement. Bienvenue chez Ducati Bruxelles.',
    welcomeAccess: 'Vous pourrez désormais retrouver vos informations et celles de vos achats et de vos véhicules directement sur {host}.',
    inviteSubjectSignup: 'Bienvenue chez Ducati Bruxelles',
    inviteSubjectClient: 'Votre espace client Ducati Bruxelles',
    inviteSubjectStaff: 'Votre compte Ducati Bruxelles',
    inviteKnown: 'Nous vous connaissions déjà : pour protéger votre compte, le mot de passe saisi lors de l\'inscription n\'a pas été utilisé.',
    inviteClient: 'Ducati Bruxelles vous a créé un espace client. Vous pourrez y retrouver vos informations, vos véhicules et vos achats.',
    inviteStaff: 'Un compte a été créé pour vous sur la plateforme de gestion de Ducati Bruxelles.',
    inviteChoose: 'Pour activer votre compte, choisissez votre mot de passe en cliquant sur ce lien :',
    inviteLink: 'Choisir mon mot de passe',
    identifier: 'Votre identifiant de connexion est : {email}',
    linkOnce: 'Ce lien ne sert qu\'une fois et n\'est valable que peu de temps. S\'il a expiré, demandez-en simplement un nouveau à la concession.',
    inviteIgnoreSignup: 'Si vous n\'êtes pas à l\'origine de cette inscription, ignorez simplement ce message : sans mot de passe choisi, le compte reste inutilisable.',
    inviteIgnore: 'Si vous n\'attendiez pas ce message, vous pouvez l\'ignorer.',
    welcomeSubject: 'Bienvenue chez Ducati Bruxelles',
    welcomeIdentifier: 'Votre identifiant de connexion est : {email}, avec le mot de passe que vous avez choisi.',
    welcomeOpen: 'Accéder à mon espace client',
    welcomeIgnore: 'Si vous n\'êtes pas à l\'origine de cette inscription, répondez simplement à ce message et nous fermerons le compte.',
    welcomeBye: 'À très bientôt,',
    passwordSubject: 'Votre mot de passe a été modifié',
    passwordChanged: 'Le mot de passe de votre compte Ducati Bruxelles (identifiant {email}) a été modifié le {when}.',
    passwordIfYou: 'Si c\'est bien vous, vous n\'avez rien à faire.',
    passwordIfNot: 'Si ce n\'est pas vous, contactez-nous immédiatement en répondant à ce message ou en appelant la concession : nous bloquerons l\'accès et vous enverrons un nouveau lien.',
    passwordLogin: 'Me connecter',
    neverPassword: 'Pour votre sécurité, ce message ne contient jamais votre mot de passe.',
    resetSubject: 'Choisir un nouveau mot de passe',
    resetIntro: 'Vous avez demandé à choisir un nouveau mot de passe pour votre compte Ducati Bruxelles (identifiant {email}).',
    resetLink: 'Choisir un nouveau mot de passe',
    resetExpired: 'Ce lien ne sert qu\'une fois et n\'est valable que peu de temps. S\'il a expiré, refaites simplement la demande depuis « Mot de passe oublié ? » sur la page de connexion.',
    resetIgnore: 'Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.',
    signature: 'Ducati Bruxelles',
  },
};

const nl: MailTexts = {
  footer: {
    joinText: 'Vind al uw documenten en de opvolging van uw motor terug dankzij de app van Ducati Bruxelles.',
    loginText: 'Uw Ducati Bruxelles-ruimte staat klaar: al uw documenten en de opvolging van uw motor, op een plek.',
    perks: 'Uw facturen, de opvolging van uw werkplaatsinterventies, de foto\'s van uw motor, en ons team bereikbaar voor elke commerciele vraag.',
    joinNudge: 'Nog geen account? Maak het gratis aan:',
    loginNudge: 'Uw account wacht op u:',
    button: 'Mijn Ducati Bruxelles-ruimte',
  },
  account: {
    hello: 'Beste {name},', helloAnonymous: 'Beste,',
    welcomeTitle: 'Proficiat en bedankt voor uw registratie. Welkom bij Ducati Bruxelles.',
    welcomeAccess: 'U kunt voortaan uw gegevens en die van uw aankopen en voertuigen rechtstreeks terugvinden op {host}.',
    inviteSubjectSignup: 'Welkom bij Ducati Bruxelles',
    inviteSubjectClient: 'Uw klantenruimte bij Ducati Bruxelles',
    inviteSubjectStaff: 'Uw Ducati Bruxelles-account',
    inviteKnown: 'Wij kenden u al: om uw account te beschermen werd het wachtwoord dat u bij de inschrijving invoerde niet gebruikt.',
    inviteClient: 'Ducati Bruxelles heeft een klantenruimte voor u aangemaakt. U vindt er uw gegevens, uw voertuigen en uw aankopen terug.',
    inviteStaff: 'Er is een account voor u aangemaakt op het beheerplatform van Ducati Bruxelles.',
    inviteChoose: 'Om uw account te activeren, kiest u uw wachtwoord via deze link:',
    inviteLink: 'Mijn wachtwoord kiezen',
    identifier: 'Uw gebruikersnaam is: {email}',
    linkOnce: 'Deze link werkt slechts een keer en is maar kort geldig. Is hij verlopen, vraag dan gewoon een nieuwe aan de concessie.',
    inviteIgnoreSignup: 'Hebt u deze inschrijving niet zelf gedaan, negeer dan dit bericht: zonder gekozen wachtwoord blijft het account onbruikbaar.',
    inviteIgnore: 'Verwachtte u dit bericht niet, dan mag u het negeren.',
    welcomeSubject: 'Welkom bij Ducati Bruxelles',
    welcomeIdentifier: 'Uw gebruikersnaam is: {email}, met het wachtwoord dat u hebt gekozen.',
    welcomeOpen: 'Naar mijn klantenruimte',
    welcomeIgnore: 'Hebt u deze inschrijving niet zelf gedaan, antwoord dan gewoon op dit bericht en wij sluiten het account.',
    welcomeBye: 'Tot binnenkort,',
    passwordSubject: 'Uw wachtwoord werd gewijzigd',
    passwordChanged: 'Het wachtwoord van uw Ducati Bruxelles-account (gebruikersnaam {email}) werd gewijzigd op {when}.',
    passwordIfYou: 'Was u dat zelf, dan hoeft u niets te doen.',
    passwordIfNot: 'Was u dat niet, neem dan onmiddellijk contact met ons op door op dit bericht te antwoorden of de concessie te bellen: wij blokkeren de toegang en sturen u een nieuwe link.',
    passwordLogin: 'Aanmelden',
    neverPassword: 'Voor uw veiligheid bevat dit bericht nooit uw wachtwoord.',
    resetSubject: 'Een nieuw wachtwoord kiezen',
    resetIntro: 'U hebt gevraagd om een nieuw wachtwoord te kiezen voor uw Ducati Bruxelles-account (gebruikersnaam {email}).',
    resetLink: 'Een nieuw wachtwoord kiezen',
    resetExpired: 'Deze link werkt slechts een keer en is maar kort geldig. Is hij verlopen, doe dan gewoon een nieuwe aanvraag via "Wachtwoord vergeten?" op de aanmeldpagina.',
    resetIgnore: 'Hebt u deze aanvraag niet zelf gedaan, negeer dan dit bericht: uw huidige wachtwoord blijft geldig.',
    signature: 'Ducati Bruxelles',
  },
};

const en: MailTexts = {
  footer: {
    joinText: 'Find all your documents and the follow-up of your motorcycle with the Ducati Bruxelles app.',
    loginText: 'Your Ducati Bruxelles space is ready: all your documents and the follow-up of your motorcycle, in one place.',
    perks: 'Your invoices, the follow-up of your workshop visits, the photos of your motorcycle, and our team available for any sales enquiry.',
    joinNudge: 'No account yet? Create it for free:',
    loginNudge: 'Your account is waiting for you:',
    button: 'My Ducati Bruxelles space',
  },
  account: {
    hello: 'Hello {name},', helloAnonymous: 'Hello,',
    welcomeTitle: 'Congratulations and thank you for registering. Welcome to Ducati Bruxelles.',
    welcomeAccess: 'From now on you can find your details and those of your purchases and vehicles directly on {host}.',
    inviteSubjectSignup: 'Welcome to Ducati Bruxelles',
    inviteSubjectClient: 'Your Ducati Bruxelles customer space',
    inviteSubjectStaff: 'Your Ducati Bruxelles account',
    inviteKnown: 'We already knew you: to protect your account, the password entered during registration was not used.',
    inviteClient: 'Ducati Bruxelles has created a customer space for you. There you will find your details, your vehicles and your purchases.',
    inviteStaff: 'An account has been created for you on the Ducati Bruxelles management platform.',
    inviteChoose: 'To activate your account, choose your password by clicking this link:',
    inviteLink: 'Choose my password',
    identifier: 'Your login is: {email}',
    linkOnce: 'This link works only once and is valid for a short time. If it has expired, simply ask the dealership for a new one.',
    inviteIgnoreSignup: 'If you did not register, simply ignore this message: without a chosen password, the account remains unusable.',
    inviteIgnore: 'If you were not expecting this message, you can ignore it.',
    welcomeSubject: 'Welcome to Ducati Bruxelles',
    welcomeIdentifier: 'Your login is: {email}, with the password you chose.',
    welcomeOpen: 'Go to my customer space',
    welcomeIgnore: 'If you did not register, simply reply to this message and we will close the account.',
    welcomeBye: 'See you soon,',
    passwordSubject: 'Your password has been changed',
    passwordChanged: 'The password of your Ducati Bruxelles account (login {email}) was changed on {when}.',
    passwordIfYou: 'If this was you, there is nothing to do.',
    passwordIfNot: 'If this was not you, contact us immediately by replying to this message or calling the dealership: we will block access and send you a new link.',
    passwordLogin: 'Sign in',
    neverPassword: 'For your security, this message never contains your password.',
    resetSubject: 'Choose a new password',
    resetIntro: 'You asked to choose a new password for your Ducati Bruxelles account (login {email}).',
    resetLink: 'Choose a new password',
    resetExpired: 'This link works only once and is valid for a short time. If it has expired, simply make the request again from "Forgot password?" on the sign-in page.',
    resetIgnore: 'If you did not make this request, ignore this message: your current password remains valid.',
    signature: 'Ducati Bruxelles',
  },
};

const it: MailTexts = {
  footer: {
    joinText: 'Ritrovi tutti i suoi documenti e il seguito della sua moto grazie all\'applicazione Ducati Bruxelles.',
    loginText: 'Il suo spazio Ducati Bruxelles è pronto: tutti i suoi documenti e il seguito della sua moto, nello stesso posto.',
    perks: 'Le sue fatture, il seguito dei suoi interventi in officina, le foto della sua moto, e il nostro team raggiungibile per qualsiasi richiesta commerciale.',
    joinNudge: 'Non ha ancora un account? Lo crei gratuitamente:',
    loginNudge: 'Il suo account la aspetta:',
    button: 'Il mio spazio Ducati Bruxelles',
  },
  account: {
    hello: 'Buongiorno {name},', helloAnonymous: 'Buongiorno,',
    welcomeTitle: 'Complimenti e grazie per la registrazione. Benvenuto da Ducati Bruxelles.',
    welcomeAccess: 'D\'ora in poi potrà ritrovare le sue informazioni e quelle dei suoi acquisti e dei suoi veicoli direttamente su {host}.',
    inviteSubjectSignup: 'Benvenuto da Ducati Bruxelles',
    inviteSubjectClient: 'Il suo spazio cliente Ducati Bruxelles',
    inviteSubjectStaff: 'Il suo account Ducati Bruxelles',
    inviteKnown: 'La conoscevamo già: per proteggere il suo account, la password inserita durante l\'iscrizione non è stata utilizzata.',
    inviteClient: 'Ducati Bruxelles le ha creato uno spazio cliente. Vi potrà ritrovare le sue informazioni, i suoi veicoli e i suoi acquisti.',
    inviteStaff: 'È stato creato un account per lei sulla piattaforma di gestione di Ducati Bruxelles.',
    inviteChoose: 'Per attivare il suo account, scelga la sua password cliccando su questo link:',
    inviteLink: 'Scegliere la mia password',
    identifier: 'Il suo identificativo di accesso è: {email}',
    linkOnce: 'Questo link funziona una sola volta ed è valido per poco tempo. Se è scaduto, ne chieda semplicemente uno nuovo alla concessionaria.',
    inviteIgnoreSignup: 'Se non è lei all\'origine di questa iscrizione, ignori semplicemente questo messaggio: senza password scelta, l\'account resta inutilizzabile.',
    inviteIgnore: 'Se non aspettava questo messaggio, può ignorarlo.',
    welcomeSubject: 'Benvenuto da Ducati Bruxelles',
    welcomeIdentifier: 'Il suo identificativo di accesso è: {email}, con la password che ha scelto.',
    welcomeOpen: 'Accedere al mio spazio cliente',
    welcomeIgnore: 'Se non è lei all\'origine di questa iscrizione, risponda semplicemente a questo messaggio e chiuderemo l\'account.',
    welcomeBye: 'A presto,',
    passwordSubject: 'La sua password è stata modificata',
    passwordChanged: 'La password del suo account Ducati Bruxelles (identificativo {email}) è stata modificata il {when}.',
    passwordIfYou: 'Se è stato lei, non deve fare nulla.',
    passwordIfNot: 'Se non è stato lei, ci contatti immediatamente rispondendo a questo messaggio o chiamando la concessionaria: bloccheremo l\'accesso e le invieremo un nuovo link.',
    passwordLogin: 'Accedere',
    neverPassword: 'Per la sua sicurezza, questo messaggio non contiene mai la sua password.',
    resetSubject: 'Scegliere una nuova password',
    resetIntro: 'Ha chiesto di scegliere una nuova password per il suo account Ducati Bruxelles (identificativo {email}).',
    resetLink: 'Scegliere una nuova password',
    resetExpired: 'Questo link funziona una sola volta ed è valido per poco tempo. Se è scaduto, rifaccia semplicemente la richiesta da "Password dimenticata?" nella pagina di accesso.',
    resetIgnore: 'Se non è lei all\'origine di questa richiesta, ignori questo messaggio: la sua password attuale resta valida.',
    signature: 'Ducati Bruxelles',
  },
};

export const MAIL_TEXTS: Record<MailLocale, MailTexts> = { fr, nl, en, it };

/** Textes d'une langue (FR si inconnue). */
export function mailTexts(locale: unknown): MailTexts {
  return MAIL_TEXTS[asMailLocale(locale) ?? DEFAULT_MAIL_LOCALE];
}

/** Remplace `{name}`, `{email}`… ; les valeurs sont insérées telles quelles (échapper avant si HTML). */
export function fillMail(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), text);
}

/** Date et heure d'un mail de sécurité, dans la langue du destinataire (fuseau de Bruxelles). */
export function mailDateTime(locale: MailLocale, date = new Date()): string {
  const tag = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB', it: 'it-IT' }[locale];
  return date.toLocaleString(tag, { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' });
}
