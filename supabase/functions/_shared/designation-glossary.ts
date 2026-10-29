/**
 * M2 — Glossaire mecanique des designations de pieces (FR / NL / EN / IT).
 *
 * Etage 1 du moteur de traduction (decision client du 30/10/2026, I18N002) :
 * un dictionnaire deterministe, pur TypeScript, partage par l'application
 * (src/modules/articles/translate) et par l'Edge Function translate-designations.
 * Il couvre les mots les plus frequents des designations IT et EN constatees en
 * production (SUPPORTO, SERBATOIO, FRONT, BRAKE, ASSY...) et le vocabulaire
 * vetements / couleurs repris de l'ancien glossaire d'import.
 *
 * Chaque entree donne UN concept dans les quatre langues :
 *   - role 'n' : nom (porte un genre FR pour l'accord des adjectifs) ;
 *   - role 'a' : adjectif ou qualificatif (AVANT, COMPLET, NOIR, TITANE...) ;
 *   - role 'x' : invariant, identique dans les quatre langues (KIT, ABS, TCEIF).
 * `alt` liste d'autres formes reconnues en entree (pluriels, abreviations, synonymes).
 * Les formes de sortie sont en MAJUSCULES SANS ACCENT, comme les tarifs Ducati.
 *
 * Aucune apostrophe courbe ici (regle du projet) : les formes avec apostrophe
 * utilisent l'apostrophe droite.
 */

export type Lang = 'fr' | 'nl' | 'en' | 'it';
export const LANGS: Lang[] = ['fr', 'nl', 'en', 'it'];

export type Role = 'n' | 'a' | 'x';

export type GlossaryEntry = {
  role: Role;
  fr: string;
  nl: string;
  en: string;
  it: string;
  /** Genre FR du nom (accord des adjectifs) : 'm' par defaut. */
  g?: 'm' | 'f';
  /** Nom FR au pluriel (PLAQUETTES, GANTS) : les adjectifs prennent un S. */
  pl?: boolean;
  /** Forme feminine FR de l'adjectif (COMPLETE, NOIRE) ; sinon invariable. */
  frF?: string;
  /** Forme feminine IT de l'adjectif (COMPLETA, NERA) ; sinon invariable. */
  itF?: string;
  /** Autres formes acceptees en entree, par langue. */
  alt?: Partial<Record<Lang, string[]>>;
};

type N = [fr: string, nl: string, en: string, it: string, opts?: Omit<GlossaryEntry, 'role' | 'fr' | 'nl' | 'en' | 'it'>];

const n = (...a: N): GlossaryEntry => ({ role: 'n', fr: a[0], nl: a[1], en: a[2], it: a[3], ...(a[4] ?? {}) });
const a = (...a: N): GlossaryEntry => ({ role: 'a', fr: a[0], nl: a[1], en: a[2], it: a[3], ...(a[4] ?? {}) });
const x = (word: string, alt?: Partial<Record<Lang, string[]>>): GlossaryEntry =>
  ({ role: 'x', fr: word, nl: word, en: word, it: word, ...(alt ? { alt } : {}) });

/**
 * Le glossaire. L'ORDRE compte quand une meme forme apparait dans deux entrees
 * (ex. NL RING) : la premiere entree gagne en lecture.
 */
export const GLOSSARY: GlossaryEntry[] = [
  // ─── Supports, fixations ───────────────────────────────────────────────────
  n('SUPPORT', 'STEUN', 'SUPPORT', 'SUPPORTO', { alt: { it: ['SUPP', 'SUPPORTI'], en: ['SUPPORTS'], fr: ['SUPPORTS'], nl: ['STEUNEN'] } }),
  n('PATTE', 'BEUGEL', 'BRACKET', 'STAFFA', { g: 'f', alt: { it: ['STAFFE'], en: ['BRACKETS'], fr: ['PATTES'] } }),
  n('SUPPORT', 'HOUDER', 'HOLDER', 'PORTA', { alt: { en: ['HOLDERS'] } }),
  n('FIXATION', 'BEVESTIGING', 'MOUNT', 'FISSAGGIO', { g: 'f', alt: { en: ['MOUNTING', 'FIXING'], fr: ['FIXATIONS'] } }),
  n('ENSEMBLE', 'SAMENSTEL', 'ASSEMBLY', 'ASSIEME', { alt: { en: ['ASSY', "ASS'Y", 'ASM'], it: ['GRUPPO', 'ASS'] } }),
  n('JEU', 'SET', 'SET', 'SERIE', { alt: { fr: ['JEUX'] } }),
  n('PAIRE', 'PAAR', 'PAIR', 'COPPIA', { g: 'f', alt: { it: ['PAIO'] } }),
  n('UNITE', 'EENHEID', 'UNIT', 'UNITA', { g: 'f', alt: { fr: ['UNITÉ'], it: ["UNITA'", 'UNITÀ'] } }),
  n('OUTIL', 'GEREEDSCHAP', 'TOOL', 'ATTREZZO', { alt: { it: ['UTENSILE', 'ATTREZZI'], en: ['TOOLS'], fr: ['OUTILS'] } }),

  // ─── Visserie ──────────────────────────────────────────────────────────────
  n('VIS', 'SCHROEF', 'SCREW', 'VITE', { g: 'f', alt: { it: ['VITI'], en: ['SCREWS'], nl: ['SCHROEVEN'] } }),
  n('BOULON', 'BOUT', 'BOLT', 'BULLONE', { alt: { it: ['BULLONI'], en: ['BOLTS'], fr: ['BOULONS'] } }),
  n('ECROU', 'MOER', 'NUT', 'DADO', { alt: { fr: ['ÉCROU', 'ECROUS'], it: ['DADI'], en: ['NUTS'] } }),
  n('RONDELLE', 'SLUITRING', 'WASHER', 'RONDELLA', { g: 'f', alt: { it: ['RONDELLE'], en: ['WASHERS'], fr: ['RONDELLES'], nl: ['RING'] } }),
  n('ENTRETOISE', 'AFSTANDSBUS', 'SPACER', 'DISTANZIALE', { g: 'f', alt: { it: ['DISTANZIALI'], en: ['SPACERS'], fr: ['ENTRETOISES'] } }),
  n('GOUJON', 'TAPEIND', 'STUD', 'PRIGIONIERO', { alt: { en: ['STUDS'] } }),
  n('AXE', 'PEN', 'PIN', 'PERNO', { alt: { it: ['PERNI'], en: ['PINS'] } }),
  n('AXE', 'AS', 'AXLE', 'ASSE'),
  n('BAGUE', 'BUS', 'BUSHING', 'BOCCOLA', { g: 'f', alt: { en: ['BUSH', 'BUSHINGS'], it: ['BOCCOLE'], fr: ['BAGUES'] } }),
  n('GOUPILLE', 'PASPEN', 'DOWEL', 'SPINA', { g: 'f', alt: { en: ['DOWEL PIN'] } }),
  n('CIRCLIP', 'BORGRING', 'CIRCLIP', 'SEEGER', { alt: { en: ['SNAP RING'], it: ['ANELLO SEEGER'] } }),
  n('ANNEAU', 'RING', 'RING', 'ANELLO', { alt: { it: ['ANELLI'], en: ['RINGS'], fr: ['ANNEAUX'] } }),
  n('RIVET', 'KLINKNAGEL', 'RIVET', 'RIVETTO', { alt: { it: ['RIVETTI'] } }),
  n('COLLIER', 'KLEM', 'CLAMP', 'FASCETTA', { alt: { it: ['FASCETTE'], en: ['CLAMPS'], fr: ['COLLIERS'] } }),
  n('CLE', 'SLEUTEL', 'KEY', 'CHIAVE', { g: 'f', alt: { fr: ['CLÉ', 'CLEF'], it: ['CHIAVI'], en: ['KEYS'] } }),
  n('BOUCHON', 'DOP', 'CAP', 'TAPPO', { alt: { it: ['TAPPI'], en: ['PLUG', 'CAPS'] } }),
  n('CALE', 'VULPLAATJE', 'SHIM', 'SPESSORE', { g: 'f', alt: { en: ['SHIMS'], it: ['SPESSORI'] } }),
  n('CLIP', 'CLIP', 'CLIP', 'CLIP', { alt: { en: ['CLIPS'] } }),
  n('CROCHET', 'HAAK', 'HOOK', 'GANCIO', { alt: { it: ['GANCI'] } }),
  n('SANGLE', 'SPANBAND', 'STRAP', 'CINTURINO', { g: 'f' }),
  n('PASSE-FIL', 'DOORVOERRUBBER', 'GROMMET', 'PASSACAVO'),
  n('GUIDE', 'GELEIDER', 'GUIDE', 'GUIDA', { alt: { it: ['GUIDE'] } }),

  // ─── Joints, roulements, ressorts ─────────────────────────────────────────
  n('JOINT', 'PAKKING', 'GASKET', 'GUARNIZIONE', { alt: { it: ['GUARNIZIONI'], en: ['GASKETS'], fr: ['JOINTS'] } }),
  n('JOINT', 'AFDICHTING', 'SEAL', 'TENUTA', { alt: { en: ['SEALS'] } }),
  n('JOINT SPI', 'KEERRING', 'OIL SEAL', 'PARAOLIO', { alt: { en: ['OILSEAL'], it: ['PARAOLI'] } }),
  n('JOINT TORIQUE', 'O-RING', 'O-RING', 'O-RING', { alt: { it: ['OR', 'ANELLO OR'], en: ['ORING'] } }),
  n('ROULEMENT', 'LAGER', 'BEARING', 'CUSCINETTO', { alt: { it: ['CUSCINETTI'], en: ['BEARINGS'], fr: ['ROULEMENTS'] } }),
  n('RESSORT', 'VEER', 'SPRING', 'MOLLA', { alt: { it: ['MOLLE'], en: ['SPRINGS'], fr: ['RESSORTS'] } }),
  n('MEMBRANE', 'MEMBRAAN', 'DIAPHRAGM', 'MEMBRANA', { g: 'f' }),
  n('SOUFFLET', 'HOES', 'GAITER', 'CUFFIA'),
  n('MANCHON', 'HULS', 'SLEEVE', 'MANICOTTO', { alt: { it: ['MANICOTTI'] } }),

  // ─── Tubes, durites, cables ────────────────────────────────────────────────
  n('TUBE', 'BUIS', 'PIPE', 'TUBO', { alt: { it: ['TUBI'], en: ['TUBE', 'PIPES'], fr: ['TUBES'] } }),
  n('DURITE', 'SLANG', 'HOSE', 'TUBO FLESSIBILE', { g: 'f', alt: { en: ['HOSES'], fr: ['DURITES'] } }),
  n('DURITE', 'LEIDING', 'LINE', 'TUBAZIONE', { g: 'f', alt: { en: ['LINES'], it: ['TUBAZIONI'] } }),
  n('CABLE', 'KABEL', 'CABLE', 'CAVO', { alt: { fr: ['CÂBLE', 'CABLES'], it: ['CAVI'], en: ['CABLES'] } }),
  n('FAISCEAU', 'KABELBOOM', 'HARNESS', 'CABLAGGIO', { alt: { en: ['WIRING', 'WIRING HARNESS', 'LOOM'], it: ['CABLAGGI'] } }),
  n('FIL', 'DRAAD', 'WIRE', 'FILO', { alt: { en: ['WIRES'] } }),
  n('CONNECTEUR', 'CONNECTOR', 'CONNECTOR', 'CONNETTORE', { alt: { it: ['CONNETTORI'] } }),
  n('TIGE', 'STANG', 'ROD', 'ASTA', { g: 'f', alt: { it: ['ASTE'] } }),
  n('BARRE', 'BAR', 'BAR', 'BARRA', { g: 'f' }),
  n('BIELLETTE', 'SCHAKEL', 'LINK', 'BIELLETTA', { g: 'f', alt: { it: ['TIRANTE'], en: ['LINKAGE'] } }),
  n('BRAS', 'ARM', 'ARM', 'BRACCIO'),

  // ─── Moteur ────────────────────────────────────────────────────────────────
  n('MOTEUR', 'MOTOR', 'ENGINE', 'MOTORE', { alt: { en: ['MOTOR'] } }),
  n('PISTON', 'ZUIGER', 'PISTON', 'PISTONE', { alt: { it: ['PISTONI'], en: ['PISTONS'] } }),
  n('CYLINDRE', 'CILINDER', 'CYLINDER', 'CILINDRO', { alt: { it: ['CILINDRI'] } }),
  n('CULASSE', 'CILINDERKOP', 'HEAD', 'TESTA', { g: 'f', alt: { en: ['CYLINDER HEAD'], it: ['TESTATA'] } }),
  n('CARTER', 'CARTER', 'CASE', 'CARTER', { alt: { en: ['CRANKCASE', 'CASING', 'COVER CASE'] } }),
  n('COUVERCLE', 'DEKSEL', 'COVER', 'COPERCHIO', { alt: { it: ['COPERCHI'], en: ['COVERS'], fr: ['COUVERCLES'] } }),
  n('SOUPAPE', 'KLEP', 'VALVE', 'VALVOLA', { g: 'f', alt: { it: ['VALVOLE'], en: ['VALVES'], fr: ['SOUPAPES'] } }),
  n('VILEBREQUIN', 'KRUKAS', 'CRANKSHAFT', 'ALBERO MOTORE'),
  n('ARBRE A CAMES', 'NOKKENAS', 'CAMSHAFT', 'ALBERO A CAMME', { alt: { it: ['ALBERO DISTRIBUZIONE'] } }),
  n('ARBRE', 'AS', 'SHAFT', 'ALBERO', { alt: { it: ['ALBERI'] } }),
  n('BIELLE', 'DRIJFSTANG', 'CONNECTING ROD', 'BIELLA', { g: 'f', alt: { en: ['CONROD'] } }),
  n('CULBUTEUR', 'TUIMELAAR', 'ROCKER ARM', 'BILANCIERE', { alt: { en: ['ROCKER'], it: ['BILANCIERI'] } }),
  n('COURROIE', 'RIEM', 'BELT', 'CINGHIA', { g: 'f', alt: { it: ['CINGHIE'], en: ['BELTS'] } }),
  n('TENDEUR', 'SPANNER', 'TENSIONER', 'TENDITORE'),
  n('POULIE', 'POELIE', 'PULLEY', 'PULEGGIA', { g: 'f' }),
  n('GALET', 'ROL', 'ROLLER', 'RULLO', { alt: { it: ['RULLI'] } }),
  n('ENGRENAGE', 'TANDWIEL', 'GEAR', 'INGRANAGGIO', { alt: { it: ['INGRANAGGI'], en: ['GEARS'] } }),
  n('BOITE DE VITESSES', 'VERSNELLINGSBAK', 'GEARBOX', 'CAMBIO', { g: 'f', alt: { fr: ['BOÎTE DE VITESSES'] } }),
  n('EMBRAYAGE', 'KOPPELING', 'CLUTCH', 'FRIZIONE'),
  n('VOLANT', 'VLIEGWIEL', 'FLYWHEEL', 'VOLANO'),
  n('DEMARREUR', 'STARTMOTOR', 'STARTER', 'MOTORINO AVVIAMENTO', { alt: { fr: ['DÉMARREUR'], it: ['AVVIAMENTO', 'MOTORINO DI AVVIAMENTO'] } }),
  n('ALTERNATEUR', 'DYNAMO', 'ALTERNATOR', 'ALTERNATORE', { alt: { it: ['GENERATORE'] } }),
  n('ALLUMAGE', 'ONTSTEKING', 'IGNITION', 'ACCENSIONE'),
  n('BOUGIE', 'BOUGIE', 'SPARK PLUG', 'CANDELA', { g: 'f', alt: { en: ['SPARKPLUG'], it: ['CANDELE'] } }),
  n('BOBINE', 'BOBINE', 'COIL', 'BOBINA', { g: 'f' }),
  n('INJECTEUR', 'INJECTOR', 'INJECTOR', 'INIETTORE', { alt: { it: ['INIETTORI'] } }),
  n('CORPS PAPILLON', 'GASKLEPHUIS', 'THROTTLE BODY', 'CORPO FARFALLATO'),
  n('CARBURATEUR', 'CARBURATEUR', 'CARBURETTOR', 'CARBURATORE', { alt: { en: ['CARBURETOR', 'CARB'] } }),
  n('GICLEUR', 'SPROEIER', 'JET', 'GETTO'),
  n('FLOTTEUR', 'VLOTTER', 'FLOAT', 'GALLEGGIANTE'),
  n('AIGUILLE', 'NAALD', 'NEEDLE', 'SPILLO', { g: 'f', alt: { it: ['AGO'] } }),
  n('GAZ', 'GAS', 'THROTTLE', 'ACCELERATORE', { alt: { it: ['GAS'] } }),
  n('ADMISSION', 'INLAAT', 'INTAKE', 'ASPIRAZIONE', { g: 'f', alt: { en: ['INLET'] } }),
  n('ECHAPPEMENT', 'UITLAAT', 'EXHAUST', 'SCARICO', { alt: { fr: ['ÉCHAPPEMENT'] } }),
  n('SILENCIEUX', 'DEMPER', 'SILENCER', 'SILENZIATORE', { alt: { en: ['MUFFLER'], it: ['SILENZIATORI'] } }),
  n('COLLECTEUR', 'SPRUITSTUK', 'MANIFOLD', 'COLLETTORE', { alt: { it: ['COLLETTORI'] } }),
  n('PARE-CHALEUR', 'HITTESCHILD', 'HEAT SHIELD', 'PARACALORE', { alt: { en: ['HEATSHIELD'] } }),
  n('FILTRE', 'FILTER', 'FILTER', 'FILTRO', { alt: { it: ['FILTRI'], en: ['FILTERS'] } }),
  n('HUILE', 'OLIE', 'OIL', 'OLIO', { g: 'f' }),
  n('EAU', 'WATER', 'WATER', 'ACQUA', { g: 'f' }),
  n('AIR', 'LUCHT', 'AIR', 'ARIA'),
  n('CARBURANT', 'BRANDSTOF', 'FUEL', 'CARBURANTE', { alt: { en: ['PETROL'], it: ['BENZINA'], fr: ['ESSENCE'] } }),
  n('RADIATEUR', 'RADIATEUR', 'RADIATOR', 'RADIATORE', { alt: { it: ['RADIATORI'] } }),
  n('THERMOSTAT', 'THERMOSTAAT', 'THERMOSTAT', 'TERMOSTATO'),
  n('VENTILATEUR', 'VENTILATOR', 'FAN', 'VENTOLA', { alt: { it: ['ELETTROVENTOLA'] } }),
  n('REFROIDISSEMENT', 'KOELING', 'COOLING', 'RAFFREDDAMENTO'),
  n('LUBRIFICATION', 'SMERING', 'LUBRICATION', 'LUBRIFICAZIONE', { g: 'f' }),
  n('POMPE', 'POMP', 'PUMP', 'POMPA', { g: 'f', alt: { it: ['POMPE'], en: ['PUMPS'] } }),
  n('TRANSMISSION', 'TRANSMISSIE', 'TRANSMISSION', 'TRASMISSIONE', { g: 'f' }),
  n('RESERVOIR', 'TANK', 'TANK', 'SERBATOIO', { alt: { fr: ['RÉSERVOIR'], it: ['SERBATOI'] } }),

  // ─── Partie cycle ──────────────────────────────────────────────────────────
  n('CADRE', 'FRAME', 'FRAME', 'TELAIO'),
  n('BRAS OSCILLANT', 'ACHTERBRUG', 'SWINGARM', 'FORCELLONE', { alt: { en: ['SWING ARM'] } }),
  n('FOURCHE', 'VORK', 'FORK', 'FORCELLA', { g: 'f', alt: { nl: ['VOORVORK'], en: ['FORKS'], it: ['FORCELLE'] } }),
  n('AMORTISSEUR', 'SCHOKDEMPER', 'SHOCK ABSORBER', 'AMMORTIZZATORE', { alt: { en: ['SHOCK', 'DAMPER', 'SHOCKABSORBER'], it: ['AMMORTIZZATORI'] } }),
  n('SUSPENSION', 'VERING', 'SUSPENSION', 'SOSPENSIONE', { g: 'f' }),
  n('DIRECTION', 'BESTURING', 'STEERING', 'STERZO', { g: 'f' }),
  n('GUIDON', 'STUUR', 'HANDLEBAR', 'MANUBRIO', { alt: { en: ['HANDLEBARS', 'HANDLE BAR'] } }),
  n('POIGNEE', 'HANDVAT', 'GRIP', 'MANOPOLA', { g: 'f', alt: { fr: ['POIGNÉE'], en: ['GRIPS', 'HANDLE'], it: ['MANOPOLE'] } }),
  n('LEVIER', 'HENDEL', 'LEVER', 'LEVA', { alt: { it: ['LEVE'], en: ['LEVERS'], fr: ['LEVIERS'] } }),
  n('PEDALE', 'PEDAAL', 'PEDAL', 'PEDALE', { g: 'f', alt: { fr: ['PÉDALE'] } }),
  n('REPOSE-PIED', 'VOETSTEUN', 'FOOTREST', 'PEDANA', { alt: { en: ['FOOTPEG', 'FOOTRESTS'], it: ['PEDANE'] } }),
  n('BEQUILLE', 'STANDAARD', 'STAND', 'CAVALLETTO', { g: 'f', alt: { fr: ['BÉQUILLE'] } }),
  n('ROUE', 'WIEL', 'WHEEL', 'RUOTA', { g: 'f', alt: { it: ['RUOTE'], en: ['WHEELS'], fr: ['ROUES'] } }),
  n('JANTE', 'VELG', 'RIM', 'CERCHIO', { g: 'f', alt: { it: ['CERCHIONE'] } }),
  n('MOYEU', 'NAAF', 'HUB', 'MOZZO'),
  n('PNEU', 'BAND', 'TYRE', 'PNEUMATICO', { alt: { en: ['TIRE'], it: ['GOMMA'] } }),
  n('CHAINE', 'KETTING', 'CHAIN', 'CATENA', { g: 'f', alt: { fr: ['CHAÎNE'] } }),
  n('PIGNON', 'VOORTANDWIEL', 'SPROCKET', 'PIGNONE'),
  n('COURONNE', 'ACHTERTANDWIEL', 'REAR SPROCKET', 'CORONA', { g: 'f' }),
  n('FREIN', 'REM', 'BRAKE', 'FRENO', { alt: { it: ['FRENI'], en: ['BRAKES'], fr: ['FREINS'] } }),
  n('DISQUE', 'SCHIJF', 'DISC', 'DISCO', { alt: { en: ['DISK', 'ROTOR'], it: ['DISCHI'], fr: ['DISQUES'] } }),
  n('PLAQUETTES', 'REMBLOKKEN', 'PADS', 'PASTIGLIE', { g: 'f', pl: true, alt: { en: ['PAD', 'BRAKE PADS'], it: ['PASTIGLIA'], fr: ['PLAQUETTE'] } }),
  n('ETRIER', 'REMKLAUW', 'CALIPER', 'PINZA', { alt: { fr: ['ÉTRIER'], en: ['CALLIPER'], it: ['PINZE'] } }),
  n('MAITRE-CYLINDRE', 'HOOFDREMCILINDER', 'MASTER CYLINDER', 'POMPA FRENO'),
  n('SELLE', 'ZADEL', 'SEAT', 'SELLA', { g: 'f', alt: { en: ['SADDLE'], it: ['SELLE'] } }),
  n('CARENAGE', 'KUIP', 'FAIRING', 'CARENA', { alt: { fr: ['CARÉNAGE'], it: ['CARENATURA', 'CARENE'], en: ['FAIRINGS'], nl: ['KUIPDEEL'] } }),
  n('CACHE LATERAL', 'ZIJPANEEL', 'SIDE PANEL', 'FIANCHETTO', { alt: { it: ['FIANCHETTI'] } }),
  n('PANNEAU', 'PANEEL', 'PANEL', 'PANNELLO', { alt: { it: ['PANNELLI'] } }),
  n('GARDE-BOUE', 'SPATBORD', 'FENDER', 'PARAFANGO', { alt: { en: ['MUDGUARD'] } }),
  n('BULLE', 'WINDSCHERM', 'WINDSCREEN', 'CUPOLINO', { g: 'f', alt: { en: ['WINDSHIELD', 'SCREEN'], fr: ['PARE-BRISE'], it: ['PLEXI', 'PLEXIGLASS'] } }),
  n('PROTECTION', 'BESCHERMING', 'GUARD', 'PROTEZIONE', { g: 'f', alt: { en: ['PROTECTION', 'PROTECTOR'], it: ['PROTEZIONI'], fr: ['PROTECTIONS'] } }),
  n('GRILLE', 'ROOSTER', 'GRILLE', 'GRIGLIA', { g: 'f', alt: { en: ['GRILL'] } }),
  n('PLAQUE', 'PLAAT', 'PLATE', 'PIASTRA', { g: 'f', alt: { it: ['PIASTRE'], en: ['PLATES'] } }),
  n('PLAQUE D\'IMMATRICULATION', 'KENTEKENPLAAT', 'NUMBER PLATE', 'TARGA', { g: 'f', alt: { en: ['LICENSE PLATE'] } }),
  n('SERRURE', 'SLOT', 'LOCK', 'SERRATURA', { g: 'f' }),
  n('BOITIER', 'BEHUIZING', 'HOUSING', 'SCATOLA', { alt: { fr: ['BOÎTIER'] } }),
  n('BOITE', 'DOOS', 'BOX', 'CASSETTA', { g: 'f', alt: { fr: ['BOÎTE'] } }),
  n('CORPS', 'HUIS', 'BODY', 'CORPO'),
  n('BRIDE', 'FLENS', 'FLANGE', 'FLANGIA', { g: 'f' }),
  n('CAOUTCHOUC', 'RUBBER', 'RUBBER', 'GOMMINO', { alt: { it: ['GOMMINI'] } }),
  n('AUTOCOLLANT', 'STICKER', 'STICKER', 'ADESIVO', { alt: { it: ['ADESIVI'], en: ['DECAL', 'STICKERS'], fr: ['AUTOCOLLANTS'] } }),
  n('EMBLEME', 'EMBLEEM', 'EMBLEM', 'EMBLEMA', { alt: { en: ['BADGE'] } }),

  // ─── Electricite, tableau de bord ──────────────────────────────────────────
  n('BATTERIE', 'ACCU', 'BATTERY', 'BATTERIA', { g: 'f', alt: { nl: ['BATTERIJ'] } }),
  n('CAPTEUR', 'SENSOR', 'SENSOR', 'SENSORE', { alt: { it: ['SENSORI'], en: ['SENSORS'] } }),
  n('INTERRUPTEUR', 'SCHAKELAAR', 'SWITCH', 'INTERRUTTORE', { alt: { it: ['INTERRUTTORI'] } }),
  n('CENTRALE', 'REGELEENHEID', 'CONTROL UNIT', 'CENTRALINA', { g: 'f', alt: { en: ['ECU'] } }),
  n('TABLEAU DE BORD', 'DASHBOARD', 'DASHBOARD', 'CRUSCOTTO', { alt: { en: ['INSTRUMENT PANEL'] } }),
  n('COMPTEUR', 'SNELHEIDSMETER', 'SPEEDOMETER', 'CONTACHILOMETRI', { alt: { en: ['SPEEDO'], it: ['CONTAKM'] } }),
  n('COMPTE-TOURS', 'TOERENTELLER', 'TACHOMETER', 'CONTAGIRI'),
  n('INSTRUMENT', 'INSTRUMENT', 'INSTRUMENT', 'STRUMENTO', { alt: { it: ['STRUMENTAZIONE'] } }),
  n('PHARE', 'KOPLAMP', 'HEADLIGHT', 'FARO', { alt: { en: ['HEADLAMP'], it: ['FANALE', 'PROIETTORE'] } }),
  n('FEU', 'LICHT', 'LIGHT', 'LUCE', { alt: { en: ['LAMP', 'LIGHTS'], it: ['LUCI'] } }),
  n('CLIGNOTANT', 'KNIPPERLICHT', 'INDICATOR', 'INDICATORE', { alt: { en: ['TURN SIGNAL', 'BLINKER'], it: ['FRECCIA', 'INDICATORE DI DIREZIONE'] } }),
  n('AMPOULE', 'LAMP', 'BULB', 'LAMPADINA', { g: 'f', alt: { it: ['LAMPADA'] } }),
  n('VERRE', 'GLAS', 'GLASS', 'VETRO'),
  n('LENTILLE', 'LENS', 'LENS', 'LENTE', { g: 'f' }),
  n('RETROVISEUR', 'SPIEGEL', 'MIRROR', 'SPECCHIO', { alt: { fr: ['RÉTROVISEUR', 'MIROIR'], it: ['SPECCHIETTO', 'SPECCHI'], en: ['MIRRORS'] } }),
  n('AVERTISSEUR', 'CLAXON', 'HORN', 'CLACSON', { alt: { en: ['KLAXON'], it: ['AVVISATORE ACUSTICO', 'AVVISATORE'] } }),
  n('RELAIS', 'RELAIS', 'RELAY', 'RELE', { alt: { it: ["RELE'", 'RELÈ'] } }),
  n('FUSIBLE', 'ZEKERING', 'FUSE', 'FUSIBILE', { alt: { it: ['FUSIBILI'] } }),
  n('REGULATEUR', 'REGELAAR', 'REGULATOR', 'REGOLATORE', { alt: { fr: ['RÉGULATEUR'] } }),

  // ─── Vetements et accessoires (ancien glossaire d'import) ──────────────────
  n('CASQUE', 'HELM', 'HELMET', 'CASCO', { alt: { it: ['CASCHI'] } }),
  n('BLOUSON', 'JAS', 'JACKET', 'GIACCA', { alt: { it: ['GIUBBINO', 'GIUBBOTTO'] } }),
  n('GANTS', 'HANDSCHOENEN', 'GLOVES', 'GUANTI', { pl: true, alt: { it: ['GUANTO'], en: ['GLOVE'], fr: ['GANT'] } }),
  n('BOTTES', 'LAARZEN', 'BOOTS', 'STIVALI', { g: 'f', pl: true, alt: { it: ['STIVALE'], fr: ['BOTTE'] } }),
  n('PANTALON', 'BROEK', 'TROUSERS', 'PANTALONE', { alt: { en: ['PANTS'], it: ['PANTALONI'] } }),
  n('COMBINAISON', 'PAK', 'SUIT', 'TUTA', { g: 'f' }),
  n('CASQUETTE', 'PET', 'CAP', 'CAPPELLINO', { g: 'f', alt: { it: ['CAPPELLO'] } }),
  n('BONNET', 'MUTS', 'BEANIE', 'BERRETTO'),
  n('SWEAT', 'SWEATER', 'SWEATSHIRT', 'FELPA', { alt: { en: ['HOODIE'] } }),
  n('MAILLOT', 'SHIRT', 'SHIRT', 'MAGLIA', { alt: { it: ['MAGLIETTA'] } }),
  n('CHEMISE', 'HEMD', 'SHIRT', 'CAMICIA', { g: 'f' }),
  n('GILET', 'VEST', 'VEST', 'GILET'),
  n('CHAUSSURES', 'SCHOENEN', 'SHOES', 'SCARPE', { g: 'f', pl: true, alt: { it: ['SCARPA'] } }),
  n('CHAUSSETTES', 'SOKKEN', 'SOCKS', 'CALZE', { g: 'f', pl: true }),
  n('CEINTURE', 'RIEM', 'BELT', 'CINTURA', { g: 'f' }),
  n('ECHARPE', 'SJAAL', 'SCARF', 'SCIARPA', { g: 'f', alt: { fr: ['ÉCHARPE'] } }),
  n('LUNETTES', 'BRIL', 'SUNGLASSES', 'OCCHIALI', { g: 'f', pl: true }),
  n('SAC', 'TAS', 'BAG', 'BORSA'),
  n('SAC A DOS', 'RUGZAK', 'BACKPACK', 'ZAINO', { alt: { en: ['BACK PACK'], fr: ['SAC À DOS'] } }),
  n('SACOCHE', 'HEUPTAS', 'POUCH', 'MARSUPIO', { g: 'f' }),
  n('PORTEFEUILLE', 'PORTEFEUILLE', 'WALLET', 'PORTAFOGLIO'),
  n('PORTE-CLES', 'SLEUTELHANGER', 'KEYRING', 'PORTACHIAVI', { alt: { en: ['KEY RING'], it: ['PORTA CHIAVI'], fr: ['PORTE-CLÉS'] } }),
  n('PARAPLUIE', 'PARAPLU', 'UMBRELLA', 'OMBRELLO'),
  n('MUG', 'MOK', 'MUG', 'TAZZA'),
  n('DRAPEAU', 'VLAG', 'FLAG', 'BANDIERA'),
  n('SERVIETTE', 'HANDDOEK', 'TOWEL', 'ASCIUGAMANO', { g: 'f' }),
  n('MINIATURE', 'SCHAALMODEL', 'MODEL', 'MODELLINO', { g: 'f' }),
  n('DORSALE', 'RUGBESCHERMER', 'BACK PROTECTOR', 'PARASCHIENA', { g: 'f' }),
  n('TAILLE', 'MAAT', 'SIZE', 'TAGLIA', { g: 'f', alt: { it: ['MISURA'] } }),
  n('COUVRE-SELLE', 'ZADELHOES', 'SEAT COVER', 'COPRISELLA'),
  n('PROTEGE-RESERVOIR', 'TANKPAD', 'TANK PAD', 'PARASERBATOIO', { alt: { it: ['COPRISERBATOIO'], fr: ['PROTÈGE-RÉSERVOIR'] } }),
  n('HOUSSE', 'HOES', 'COVER', 'TELO', { g: 'f', alt: { it: ['COPRIMOTO'], en: ['BIKE COVER'] } }),

  // ─── Positions, etats, materiaux (adjectifs) ───────────────────────────────
  a('AVANT', 'VOOR', 'FRONT', 'ANTERIORE', { alt: { it: ['ANT', 'ANTERIORI'], en: ['FRT', 'FR'], fr: ['AV'] } }),
  a('ARRIERE', 'ACHTER', 'REAR', 'POSTERIORE', { alt: { it: ['POST', 'POSTERIORI'], en: ['BACK', 'TAIL', 'RR'], fr: ['ARRIÈRE', 'AR'] } }),
  a('GAUCHE', 'LINKS', 'LEFT', 'SINISTRO', { itF: 'SINISTRA', alt: { it: ['SINISTRA', 'SX', 'SIN'], en: ['LH', 'L.H.'], fr: ['G'] } }),
  a('DROIT', 'RECHTS', 'RIGHT', 'DESTRO', { frF: 'DROITE', itF: 'DESTRA', alt: { it: ['DESTRA', 'DX', 'DES'], en: ['RH', 'R.H.'], fr: ['DROITE', 'D'] } }),
  a('SUPERIEUR', 'BOVEN', 'UPPER', 'SUPERIORE', { frF: 'SUPERIEURE', alt: { it: ['SUP', 'SUPERIORI'], en: ['TOP'], fr: ['SUPÉRIEUR', 'SUPÉRIEURE', 'SUPERIEURE', 'SUP'] } }),
  a('INFERIEUR', 'ONDER', 'LOWER', 'INFERIORE', { frF: 'INFERIEURE', alt: { it: ['INF', 'INFERIORI'], en: ['BOTTOM'], fr: ['INFÉRIEUR', 'INFÉRIEURE', 'INFERIEURE', 'INF'] } }),
  a('INTERIEUR', 'BINNEN', 'INNER', 'INTERNO', { frF: 'INTERIEURE', itF: 'INTERNA', alt: { en: ['INTERNAL', 'INSIDE'], fr: ['INTÉRIEUR', 'INTÉRIEURE', 'INTERIEURE', 'INT'], it: ['INTERNA', 'INT'] } }),
  a('EXTERIEUR', 'BUITEN', 'OUTER', 'ESTERNO', { frF: 'EXTERIEURE', itF: 'ESTERNA', alt: { en: ['EXTERNAL', 'OUTSIDE'], fr: ['EXTÉRIEUR', 'EXTÉRIEURE', 'EXTERIEURE', 'EXT'], it: ['ESTERNA', 'EST'] } }),
  a('LATERAL', 'ZIJ', 'SIDE', 'LATERALE', { frF: 'LATERALE', alt: { it: ['LAT', 'LATERALI'], fr: ['LATÉRAL', 'LATÉRALE', 'LATERALE'] } }),
  a('CENTRAL', 'CENTRAAL', 'CENTRAL', 'CENTRALE', { frF: 'CENTRALE', alt: { fr: ['CENTRALE'], en: ['CENTRE', 'CENTER', 'MIDDLE'] } }),
  a('COMPLET', 'COMPLEET', 'COMPLETE', 'COMPLETO', { frF: 'COMPLETE', itF: 'COMPLETA', alt: { it: ['COMPLETA', 'COMPL', 'CPL', 'COMPLETI'], en: ['CPL', 'COMPL'], fr: ['COMPLETE', 'COMPLÈTE', 'CPL'] } }),
  a('SPECIAL', 'SPECIAAL', 'SPECIAL', 'SPECIALE', { frF: 'SPECIALE', alt: { fr: ['SPÉCIAL', 'SPÉCIALE', 'SPECIALE'], it: ['SPECIALI'] } }),
  a('DOUBLE', 'DUBBEL', 'DOUBLE', 'DOPPIO', { itF: 'DOPPIA', alt: { it: ['DOPPIA'], en: ['DUAL', 'TWIN'] } }),
  a('SIMPLE', 'ENKEL', 'SINGLE', 'SINGOLO', { itF: 'SINGOLA', alt: { it: ['SINGOLA'] } }),
  a('REGLABLE', 'VERSTELBAAR', 'ADJUSTABLE', 'REGOLABILE', { alt: { fr: ['RÉGLABLE'] } }),
  a('ELECTRIQUE', 'ELEKTRISCH', 'ELECTRIC', 'ELETTRICO', { itF: 'ELETTRICA', alt: { fr: ['ÉLECTRIQUE'], en: ['ELECTRICAL'], it: ['ELETTRICA'] } }),
  a('HYDRAULIQUE', 'HYDRAULISCH', 'HYDRAULIC', 'IDRAULICO', { itF: 'IDRAULICA', alt: { it: ['IDRAULICA'] } }),
  a('FIXE', 'VAST', 'FIXED', 'FISSO', { itF: 'FISSA', alt: { it: ['FISSA'] } }),
  a('MOBILE', 'BEWEEGBAAR', 'MOVABLE', 'MOBILE', { alt: { en: ['MOVING'] } }),
  a('COURT', 'KORT', 'SHORT', 'CORTO', { frF: 'COURTE', itF: 'CORTA', alt: { it: ['CORTA'], fr: ['COURTE'] } }),
  a('LONG', 'LANG', 'LONG', 'LUNGO', { frF: 'LONGUE', itF: 'LUNGA', alt: { it: ['LUNGA'], fr: ['LONGUE'] } }),
  a('HAUT', 'HOOG', 'HIGH', 'ALTO', { frF: 'HAUTE', itF: 'ALTA', alt: { it: ['ALTA'], fr: ['HAUTE'] } }),
  a('BAS', 'LAAG', 'LOW', 'BASSO', { frF: 'BASSE', itF: 'BASSA', alt: { it: ['BASSA'], fr: ['BASSE'] } }),
  a('PETIT', 'KLEIN', 'SMALL', 'PICCOLO', { frF: 'PETITE', itF: 'PICCOLA', alt: { it: ['PICCOLA'], fr: ['PETITE'] } }),
  a('GRAND', 'GROOT', 'LARGE', 'GRANDE', { frF: 'GRANDE', alt: { en: ['BIG'], fr: ['GRANDE'] } }),
  a('MANUEL', 'HANDMATIG', 'MANUAL', 'MANUALE', { frF: 'MANUELLE' }),
  a('ORIGINAL', 'ORIGINEEL', 'ORIGINAL', 'ORIGINALE', { frF: 'ORIGINALE' }),
  a('HOMME', 'HEREN', 'MEN', 'UOMO', { alt: { en: ['MAN', "MEN'S", 'MENS'], it: ['UOMINI'] } }),
  a('FEMME', 'DAMES', 'WOMEN', 'DONNA', { alt: { en: ['WOMAN', 'LADY', "WOMEN'S", 'LADIES'], it: ['DONNE'] } }),
  a('ENFANT', 'KINDER', 'KIDS', 'BAMBINO', { alt: { en: ['KID', 'CHILD', 'JUNIOR'], it: ['BIMBO', 'BIMBA', 'BAMBINA', 'BAMBINI'] } }),
  a('BEBE', 'BABY', 'BABY', 'NEONATO', { alt: { fr: ['BÉBÉ'] } }),
  a('MANCHES LONGUES', 'LANGE MOUWEN', 'LONG SLEEVE', 'MANICHE LUNGHE', { alt: { it: ['MANICA LUNGA'], en: ['LONG SLEEVES'] } }),
  a('MANCHES COURTES', 'KORTE MOUWEN', 'SHORT SLEEVE', 'MANICHE CORTE', { alt: { it: ['MANICA CORTA'], en: ['SHORT SLEEVES'] } }),
  a('A CAPUCHE', 'MET CAPUCHON', 'HOODED', 'CON CAPPUCCIO', { alt: { fr: ['À CAPUCHE'] } }),
  a('IMPERMEABLE', 'WATERDICHT', 'WATERPROOF', 'IMPERMEABILE', { alt: { fr: ['IMPERMÉABLE'], it: ['ANTIPIOGGIA'] } }),
  a('THERMIQUE', 'THERMISCH', 'THERMAL', 'TERMICO', { itF: 'TERMICA', alt: { it: ['TERMICA'] } }),
  a('HIVER', 'WINTER', 'WINTER', 'INVERNALE'),
  a('ETE', 'ZOMER', 'SUMMER', 'ESTIVO', { itF: 'ESTIVA', alt: { fr: ['ÉTÉ'], it: ['ESTIVA'] } }),
  a('CUIR', 'LEER', 'LEATHER', 'PELLE'),
  a('TEXTILE', 'TEXTIEL', 'TEXTILE', 'TESSUTO'),
  a('COTON', 'KATOEN', 'COTTON', 'COTONE'),
  a('LAINE', 'WOL', 'WOOL', 'LANA'),
  a('BRODE', 'GEBORDUURD', 'EMBROIDERED', 'RICAMATO', { frF: 'BRODEE', itF: 'RICAMATA', alt: { fr: ['BRODÉ', 'BRODÉE', 'BRODEE'], it: ['RICAMATA'] } }),
  a('IMPRIME', 'BEDRUKT', 'PRINTED', 'STAMPATO', { frF: 'IMPRIMEE', itF: 'STAMPATA', alt: { fr: ['IMPRIMÉ', 'IMPRIMÉE', 'IMPRIMEE'], it: ['STAMPATA'] } }),
  a('TITANE', 'TITANIUM', 'TITANIUM', 'TITANIO', { alt: { en: ['TI'] } }),
  a('CARBONE', 'CARBON', 'CARBON', 'CARBONIO', { alt: { en: ['CARBON FIBRE', 'CARBON FIBER'], it: ['CARBON'] } }),
  a('ALUMINIUM', 'ALUMINIUM', 'ALUMINIUM', 'ALLUMINIO', { alt: { en: ['ALUMINUM', 'ALU'], it: ['ALU', 'ALL'], fr: ['ALU'] } }),
  a('ACIER', 'STAAL', 'STEEL', 'ACCIAIO'),
  a('INOX', 'RVS', 'STAINLESS', 'INOX', { alt: { en: ['STAINLESS STEEL'], fr: ['INOXYDABLE'] } }),
  a('PLASTIQUE', 'KUNSTSTOF', 'PLASTIC', 'PLASTICA'),
  a('CAOUTCHOUC', 'RUBBEREN', 'RUBBER', 'GOMMA', { alt: { it: ['IN GOMMA'] } }),
  a('MAGNESIUM', 'MAGNESIUM', 'MAGNESIUM', 'MAGNESIO'),
  a('NOIR', 'ZWART', 'BLACK', 'NERO', { frF: 'NOIRE', itF: 'NERA', alt: { it: ['NERA', 'NERI'], fr: ['NOIRE'] } }),
  a('ROUGE', 'ROOD', 'RED', 'ROSSO', { itF: 'ROSSA', alt: { it: ['ROSSA', 'ROSSI'] } }),
  a('BLANC', 'WIT', 'WHITE', 'BIANCO', { frF: 'BLANCHE', itF: 'BIANCA', alt: { it: ['BIANCA', 'BIANCHI'], fr: ['BLANCHE'] } }),
  a('GRIS', 'GRIJS', 'GREY', 'GRIGIO', { frF: 'GRISE', itF: 'GRIGIA', alt: { en: ['GRAY'], it: ['GRIGIA'], fr: ['GRISE'] } }),
  a('BLEU', 'BLAUW', 'BLUE', 'BLU', { frF: 'BLEUE', alt: { it: ['AZZURRO', 'AZZURRA'], fr: ['BLEUE'] } }),
  a('JAUNE', 'GEEL', 'YELLOW', 'GIALLO', { itF: 'GIALLA', alt: { it: ['GIALLA'] } }),
  a('VERT', 'GROEN', 'GREEN', 'VERDE', { frF: 'VERTE', alt: { fr: ['VERTE'] } }),
  a('ARGENT', 'ZILVER', 'SILVER', 'ARGENTO'),
  a('OR', 'GOUD', 'GOLD', 'ORO', { alt: { fr: ['DORE', 'DORÉ'], en: ['GOLDEN'], it: ['DORATO'] } }),
  a('MARRON', 'BRUIN', 'BROWN', 'MARRONE'),
  a('ROSE', 'ROZE', 'PINK', 'ROSA'),
  a('VIOLET', 'PAARS', 'PURPLE', 'VIOLA'),
  a('ORANGE', 'ORANJE', 'ORANGE', 'ARANCIO', { alt: { it: ['ARANCIONE'] } }),
  a('MAT', 'MAT', 'MATT', 'OPACO', { frF: 'MATE', itF: 'OPACA', alt: { en: ['MATTE'], it: ['OPACA'] } }),
  a('BRILLANT', 'GLANZEND', 'GLOSS', 'LUCIDO', { frF: 'BRILLANTE', itF: 'LUCIDA', alt: { en: ['GLOSSY'], it: ['LUCIDA'] } }),

  // ─── Invariants : codes, marques, types de vis, tailles ────────────────────
  x('KIT'), x('ABS'), x('LED'), x('USB'), x('GPS'), x('DVT'), x('EVO'), x('RACING'), x('CORSE'), x('SBK'),
  x('STATOR'), x('ROTOR'), x('LOGO'), x('T-SHIRT', { en: ['TSHIRT', 'TEE'] }), x('POLO'), x('DUCATI'), x('SCRAMBLER'),
  x('MONSTER'), x('PANIGALE'), x('MULTISTRADA'), x('DIAVEL'), x('HYPERMOTARD'), x('STREETFIGHTER'), x('SUPERSPORT'),
  x('DESERTX'), x('TERMIGNONI'), x('AKRAPOVIC'), x('BREMBO'), x('OHLINS'), x('MARZOCCHI'), x('SHOWA'), x('PIRELLI'),
  x('TCEIF'), x('TCEI'), x('TBEI'), x('TBEIF'), x('TSPEI'), x('TSPEIF'), x('TE'), x('TEF'), x('TC'), x('TSP'), x('TCCE'),
  x('XS'), x('XL'), x('XXL'), x('XXXL'), x('3XL'), x('XXS'),
];
