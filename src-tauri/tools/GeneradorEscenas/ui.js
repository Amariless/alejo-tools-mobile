// ui.js — Generador de Escenas (mobile).
//
// ══════════════════════════════════════════════════════════════════════
//  PARTE 1: engine.js de escritorio, copiado VERBATIM (sin cambios).
//  Es texto/lógica pura -- pools de vocabulario, estéticas, y la función
//  generarEscena() -- cero dependencias de DOM/Node, así que porta 1:1 sin
//  tocar una línea. Ver alejo-tools/src-tauri/tools/GeneradorEscenas/
//  engine.js para el original. Mobile no tiene un mecanismo de "assets
//  extra por herramienta" (solo ui.js + style.css, ver get_tool_ui en
//  lib.rs), así que en vez de agregar esa infraestructura solo para esto,
//  el motor se pega acá arriba y la capa de UI (parte 2, mucho más abajo)
//  lo consume como funciones/constantes de scope de módulo normales.
// ══════════════════════════════════════════════════════════════════════

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const MODIFICADORES = [
    "antigua", "abandonada", "olvidada", "decrépita", "misteriosa",
    "solitaria", "desolada", "oscura", "ruinosa", "silenciosa",
    "encantada", "sumergida", "enterrada", "oculta", "maldita",
    "futurista", "colosal", "diminuta", "flotante", "retorcida",
    "fracturada", "cristalizada", "quemada", "congelada", "distorsionada",
    "translúcida", "invertida", "laberíntica", "susurrante", "sagrada",
    "nauseabunda", "febril", "desfigurada", "atemporal", "fosforescente",
    "espectral", "descarnada", "efímera", "monumental", "corrupta",
    "simétrica", "asimétrica", "orgánica", "mecánica", "fractal",
    "vasta", "milenaria", "recóndita", "vertiginosa", "resquebrajada",
    "polvorienta", "herrumbrada", "vidriosa", "escarpada", "sinuosa",
    "hueca", "profunda", "angulosa", "porosa", "veteada",
    "desgastada", "brumosa", "cavernosa", "reluciente", "mate",
    "áspera", "tersa", "descompuesta", "reconstruida", "improvisada",
    "artesanal", "industrial", "primigenia", "latente", "sitiada",
    "custodiada", "itinerante", "nómada", "inerte", "palpitante",
    "insondable", "precaria", "estridente", "apacible", "abrupta",
    "quebradiza", "somnolienta", "esquiva", "impenetrable", "resonante",
    "abisal", "gélida", "abrasadora", "opaca", "cristalina",
    "borrosa", "difusa", "vertida", "derruida", "sellada",
    "acorazada", "blindada", "vaciada", "reconvertida", "clandestina",
    "furtiva", "estática", "vibrante", "cadente", "escondida",
    "revelada", "perpetua", "inestable", "rígida",
    "flexible", "maleable", "quieta", "trepidante", "asfixiante",
    "expansiva", "comprimida", "contenida", "desbordante", "estancada",
    "carcomida", "agrietada", "desvencijada", "encallada", "varada",
    "aletargada", "ensimismada", "taciturna", "sepultada", "replegada",
    "sedimentada", "calcinada", "vitrificada", "mineralizada", "fermentada",
    "oxidada", "bioluminiscente", "geométrica", "fragmentaria", "modular",
    "ensamblada", "desmontada", "replicada", "sintética", "biomecánica",
    "cuántica", "dimensional", "entrelazada", "colapsada", "implosionada",
    "magnetizada", "electrificada", "saturada", "diluida", "concentrada",
    "purificada", "contaminada", "radiactiva", "amurallada", "fortificada",
    "asediada", "conquistada", "tallada", "esculpida", "moldeada",
    "forjada", "templada", "bruñida", "pulida", "desbastada",
    "astillada", "carbonizada", "ennegrecida", "blanqueada", "decolorada",
    "iridiscente", "nacarada", "aterciopelada", "escamosa", "membranosa",
    "viscosa", "gelatinosa", "amorfa", "refractada", "especular",
    "proyectada", "simulada", "procedural", "algorítmica",
];

const LUGARES_BASE = [
    ["una estación de tren", "f"], ["un faro", "m"], ["una biblioteca", "f"],
    ["un mercado", "m"], ["una catedral", "f"], ["un laboratorio", "m"],
    ["una cueva", "f"], ["un cementerio", "m"], ["una mansión", "f"],
    ["un submarino", "m"], ["una aldea", "f"], ["un invernadero", "m"],
    ["una estación espacial", "f"], ["un templo", "m"], ["una fortaleza", "f"],
    ["un circo", "m"], ["una mina", "f"], ["un hospital", "m"],
    ["una escuela", "f"], ["un barco", "m"], ["una prisión", "f"],
    ["un bosque", "m"], ["una ciudad", "f"], ["un volcán", "m"],
    ["una aldea vikinga", "f"], ["un castillo", "m"], ["una central eléctrica", "f"],
    ["un callejón", "m"], ["una sala de máquinas", "f"], ["un observatorio", "m"],
    ["una catacumba", "f"], ["un bunker", "m"], ["una torre de control", "f"],
    ["un puente", "m"], ["una sala de servidores", "f"], ["un jardín zen", "m"],
    ["una clínica", "f"], ["un hangar", "m"], ["una sala de espera", "f"],
    ["un monasterio", "m"], ["una cantera", "f"], ["un acuario", "m"],
    ["una ciudad subterránea", "f"], ["un tren abandonado", "m"],
    ["una tienda de antigüedades", "f"], ["un mercado flotante", "m"],
    ["una plataforma petrolífera", "f"], ["un vertedero", "m"],
    ["una isla artificial", "f"], ["un laberinto", "m"], ["una capilla", "f"],
    ["un palacio", "m"], ["una arena de combate", "f"], ["un dique", "m"],
    ["una nave industrial", "f"], ["un teatro", "m"], ["una cripta", "f"],
    ["un crucero", "m"], ["una selva", "f"], ["un desierto", "m"],
    ["una ciudad flotante", "f"], ["un refugio nuclear", "m"],
    ["una sala de exposiciones", "f"], ["un puerto espacial", "m"],
    ["una granja abandonada", "f"], ["un coliseo", "m"],
    ["una torre de comunicaciones", "f"], ["un monolito", "m"],
    ["una caverna de cristal", "f"], ["un barrio de favelas", "m"],
    ["una sala de espejos", "f"], ["un cementerio de máquinas", "m"],
    ["un anfiteatro", "m"], ["una biosfera artificial", "f"],
    ["un archivo subterráneo", "m"], ["una sala de subastas", "f"],
    ["un búnker antiaéreo", "m"], ["una calzada romana", "f"],
    ["un canal de riego", "m"], ["una capilla ardiente", "f"],
    ["un cementerio de barcos", "m"], ["una central nuclear", "f"],
    ["un chatarrero", "m"], ["una cochera de trenes", "f"],
    ["un complejo minero", "m"], ["una cúpula geodésica", "f"],
    ["un dirigible varado", "m"], ["una ermita de montaña", "f"],
    ["un estudio de grabación", "m"], ["una feria abandonada", "f"],
    ["un fuerte colonial", "m"], ["una galería subterránea", "f"],
    ["un granero", "m"], ["una imprenta antigua", "f"],
    ["un jardín botánico", "m"], ["una lavandería industrial", "f"],
    ["un manicomio abandonado", "m"], ["una mezquita", "f"],
    ["un molino de viento", "m"], ["una necrópolis", "f"],
    ["un observatorio astronómico", "m"], ["una pagoda", "f"],
    ["un pantano", "m"], ["una pista de patinaje", "f"],
    ["un planetario", "m"], ["una plaza de mercado", "f"],
    ["un puerto pesquero", "m"], ["una represa", "f"],
    ["un santuario", "m"], ["una sinagoga", "f"],
    ["un taller de relojería", "m"], ["una terminal de buses", "f"],
    ["un vivero", "m"], ["una zona de cuarentena", "f"],
    ["un asentamiento minero en un asteroide", "m"], ["una colonia lunar", "f"],
    ["un mercado de especias", "m"], ["una plataforma flotante en el océano", "f"],
];

const ESTADOS = {
    m: [
        "cubierto de musgo", "invadido por la naturaleza", "a la deriva",
        "en llamas", "bajo el agua", "cubierto de nieve", "enterrado en arena",
        "a medio construir", "destruido a medias", "congelado en el tiempo",
        "envuelto en enredaderas", "lleno de polvo y telarañas",
        "partido en dos", "suspendido en el vacío", "cubierto de óxido",
        "colapsando lentamente", "cubierto de cristales de sal",
        "devorado por hongos luminiscentes", "en silencio absoluto",
        "lentamente hundiéndose", "consumido por la hiedra",
        "petrificado", "fragmentado en capas", "atravesado por raíces",
        "recubierto de hielo translúcido", "sellado por generaciones",
        "tallado a mano", "reconstruido con retazos", "abandonado a su suerte",
        "marcado por el tiempo", "envuelto en cables sueltos",
        "apuntalado con madera vieja", "cubierto de grafitis desvaídos",
        "iluminado a medias", "dividido por una grieta enorme",
        "ocupado por presencias invisibles", "custodiado por estatuas erosionadas",
        "rodeado de andamios oxidados", "sostenido por cuerdas y cadenas",
        "precintado con cinta amarilla", "invadido por raíces de árboles centenarios",
        "cubierto por una fina capa de ceniza", "erosionado por siglos de viento",
        "carcomido por termitas invisibles", "sostenido apenas por vigas rotas",
        "abierto de par en par al vacío", "sellado tras muros dobles",
        "iluminado por grietas en el techo", "reconstruido sobre sus propias ruinas",
        "cubierto de vendajes improvisados", "atrapado entre dos realidades",
        "reflejado infinitamente en sus propios espejos", "envuelto en un silencio expectante",
        "marcado por símbolos de advertencia", "custodiado por maquinaria dormida",
        "cubierto de líquenes fosforescentes", "rodeado de agua estancada",
        "atravesado por tuberías expuestas", "envuelto en malla de camuflaje",
        "cubierto de carteles despegados", "invadido por enjambres de insectos",
        "salpicado de pintura descascarada", "cubierto de escarcha nocturna",
        "sostenido por columnas agrietadas", "envuelto en humo residual",
        "marcado por impactos de metralla", "cubierto de arena roja",
        "custodiado por drones inactivos", "atravesado por raíces bioluminiscentes",
        "sellado con placas de metal soldadas", "cubierto de polen dorado",
        "envuelto en redes de pesca viejas", "iluminado por letreros parpadeantes",
        "recubierto de musgo radiactivo", "cubierto de hollín y ceniza fina",
    ],
    f: [
        "cubierta de musgo", "invadida por la naturaleza", "a la deriva",
        "en llamas", "bajo el agua", "cubierta de nieve", "enterrada en arena",
        "a medio construir", "destruida a medias", "congelada en el tiempo",
        "envuelta en enredaderas", "llena de polvo y telarañas",
        "partida en dos", "suspendida en el vacío", "cubierta de óxido",
        "colapsando lentamente", "cubierta de cristales de sal",
        "devorada por hongos luminiscentes", "en silencio absoluto",
        "lentamente hundiéndose", "consumida por la hiedra",
        "petrificada", "fragmentada en capas", "atravesada por raíces",
        "recubierta de hielo translúcido", "sellada por generaciones",
        "tallada a mano", "reconstruida con retazos", "abandonada a su suerte",
        "marcada por el tiempo", "envuelta en cables sueltos",
        "apuntalada con madera vieja", "cubierta de grafitis desvaídos",
        "iluminada a medias", "dividida por una grieta enorme",
        "ocupada por presencias invisibles", "custodiada por estatuas erosionadas",
        "rodeada de andamios oxidados", "sostenida por cuerdas y cadenas",
        "precintada con cinta amarilla", "invadida por raíces de árboles centenarios",
        "cubierta por una fina capa de ceniza", "erosionada por siglos de viento",
        "carcomida por termitas invisibles", "sostenida apenas por vigas rotas",
        "abierta de par en par al vacío", "sellada tras muros dobles",
        "iluminada por grietas en el techo", "reconstruida sobre sus propias ruinas",
        "cubierta de vendajes improvisados", "atrapada entre dos realidades",
        "reflejada infinitamente en sus propios espejos", "envuelta en un silencio expectante",
        "marcada por símbolos de advertencia", "custodiada por maquinaria dormida",
        "cubierta de líquenes fosforescentes", "rodeada de agua estancada",
        "atravesada por tuberías expuestas", "envuelta en malla de camuflaje",
        "cubierta de carteles despegados", "invadida por enjambres de insectos",
        "salpicada de pintura descascarada", "cubierta de escarcha nocturna",
        "sostenida por columnas agrietadas", "envuelta en humo residual",
        "marcada por impactos de metralla", "cubierta de arena roja",
        "custodiada por drones inactivos", "atravesada por raíces bioluminiscentes",
        "sellada con placas de metal soldadas", "cubierta de polen dorado",
        "envuelta en redes de pesca viejas", "iluminada por letreros parpadeantes",
        "recubierta de musgo radiactivo", "cubierta de hollín y ceniza fina",
    ],
};

const ATMOSFERAS = [
    "bajo la lluvia", "al atardecer", "en plena tormenta",
    "bajo la luz de la luna", "en la niebla", "durante un eclipse",
    "al amanecer", "en un día de tormenta eléctrica", "bajo una aurora boreal",
    "en medio de una nevada", "iluminado por lava", "bañado en luz de neón",
    "a la luz de velas", "bajo un cielo rojo", "en un desierto árido",
    "en el fondo del océano", "al borde de un abismo", "suspendido entre nubes",
    "rodeado de lava", "cubierto por la ceniza de un volcán",
    "bajo una lluvia de meteoros", "en un plano astral",
    "durante una tormenta de arena", "bajo una luz ultravioleta",
    "en una dimensión en colapso", "bajo un cielo sin estrellas",
    "mientras el sol explota en el horizonte", "en el ojo del huracán",
    "bajo una lluvia ácida", "en un bucle temporal",
    "entre la calima del mediodía", "bajo un sol pálido de invierno",
    "en la quietud previa a la tormenta", "rodeado de un silencio antinatural",
    "bajo nubes bajas y plomizas", "en el instante justo antes del alba",
    "entre ráfagas de viento cálido", "bajo un cielo cuajado de estrellas",
    "en una calma tensa", "rodeado de vapor ascendente",
    "bajo destellos de un faro lejano", "entre la bruma matinal",
    "bajo un firmamento anaranjado", "en medio de una calma sepulcral",
    "rodeado de reflejos dorados en el agua", "bajo un cielo partido por un rayo",
    "en una atmósfera densa y húmeda", "entre columnas de humo distante",
    "bajo la sombra alargada del ocaso", "en un aire cargado de electricidad estática",
    "bajo un cielo de tormenta inminente", "entre el resplandor de faroles distantes",
    "en una calma que precede al caos", "bajo capas de niebla superpuestas",
    "bajo un cielo estriado de nubes altas", "entre el zumbido lejano de insectos",
    "bajo una llovizna persistente", "en el instante de mayor calor del día",
    "entre destellos intermitentes de luz", "bajo un cielo cubierto de cenizas volcánicas",
    "en una quietud casi absoluta", "rodeado de un frío que cala los huesos",
    "bajo el rugido lejano de un trueno", "entre jirones de niebla que se disipan",
    "bajo un sol que no calienta", "en un aire inmóvil y espeso",
    "bajo destellos verdosos en el cielo", "entre el crepitar distante de algo ardiendo",
    "bajo la penumbra de nubes de tormenta", "en una quietud que antecede al desastre",
    "bajo reflejos cambiantes de luces distantes", "entre el eco húmedo de goteras",
    "bajo un cielo doble con dos lunas", "en medio de una migración de aves",
    "bajo lluvia de cenizas cósmicas", "entre auroras artificiales de neón",
    "bajo un sol binario poniéndose", "en la calma tensa de un toque de queda",
    "entre el resplandor de una ciudad distante", "bajo un cielo cruzado de satélites",
    "en la bruma de un pantano al anochecer", "bajo el eco de campanas lejanas",
    "entre chispas de un cortocircuito", "bajo la luz parpadeante de un letrero roto",
    "en el silencio posterior a una explosión", "bajo un cielo teñido de humo naranja",
    "entre el vaho helado de la respiración", "bajo destellos de una tormenta magnética",
    "en la calma artificial de un domo climatizado", "bajo lluvia radiactiva luminosa",
    "entre el polvo suspendido de una demolición", "bajo el resplandor verde de una aurora sintética",
];

const COMPLEMENTOS = [
    "con un árbol enorme en el centro", "habitado por cuervos",
    "con un espejo roto como único ornamento", "con una sola vela encendida",
    "con rastros de una batalla pasada", "donde el tiempo parece haberse detenido",
    "con una figura solitaria al fondo", "con relojes que marcan horas distintas",
    "lleno de cajas sin abrir", "con un portal brillante en la entrada",
    "cubierto de grafitis luminosos", "con una jaula vacía en el centro",
    "con agua que fluye hacia arriba", "donde las sombras se mueven solas",
    "con una escalera que no lleva a ningún lado",
    "cubierto de fotografías amarillentas",
    "con plantas que crecen en patrones geométricos",
    "con una radio que emite estática",
    "donde el suelo es de cristal sobre el vacío",
    "con mensajes escritos en las paredes",
    "con una fuente de luz sin origen visible",
    "donde los objetos flotan lentamente",
    "con ecos de voces que no tienen dueño",
    "rodeado de espejos que no reflejan lo mismo",
    "con una puerta que siempre está entreabierta",
    "donde la gravedad parece invertida",
    "con columnas de humo que no se disipan",
    "con un reloj de arena que nunca termina",
    "cubierto de simbología incomprensible",
    "con una ventana que da a otro mundo",
    "con una grieta que emite luz propia",
    "con inscripciones en un idioma olvidado",
    "donde el eco repite las palabras al revés",
    "con una figura encapuchada observando desde lejos",
    "con marcas de garras en las paredes",
    "con un mapa incompleto clavado en un tablón",
    "con velas derretidas formando montículos",
    "donde los pájaros vuelan en círculos sin motivo",
    "con una campana que suena sin nadie que la toque",
    "con huellas que no llevan a ninguna parte",
    "con un espejo cubierto por una tela",
    "con una silla que se mece sola",
    "con símbolos tallados recientemente",
    "con un olor a tierra mojada y óxido",
    "donde las luces parpadean en un patrón extraño",
    "con cadenas colgando del techo",
    "con una puerta que no debería estar ahí",
    "con una escultura cuya expresión cambia sutilmente",
    "donde el polvo forma remolinos sin viento",
    "con un pasillo que se estrecha progresivamente",
    "con estanterías repletas de objetos sin catalogar",
    "donde una única gota cae en un ritmo constante",
    "con un tapiz que representa un lugar desconocido",
    "con marcas de manos en el polvo de una superficie",
    "donde el aire vibra con un zumbido grave",
    "con una escalera de caracol que se pierde de vista",
    "con fragmentos de vidrio esparcidos ordenadamente",
    "donde conviven dos estaciones del año a la vez",
    "con una puerta reforzada sin cerradura visible",
    "con inscripciones que cambian según el ángulo",
    "donde el reflejo se adelanta al movimiento",
    "con una única ventana sellada con tablones",
    "con estatuas dispuestas en un círculo perfecto",
    "con una fila de sillas vacías mirando a la nada",
    "con un piano desafinado sonando solo",
    "donde las paredes respiran lentamente",
    "con un cartel a medio borrar en un idioma inventado",
    "con una jaula de pájaros que canta sin pájaros",
    "donde el humo forma figuras reconocibles",
    "con una mesa puesta para un banquete que nunca llegó",
    "con hilos tensados de pared a pared",
    "donde cada eco suena distinto al anterior",
    "con una pila de libros que nadie puede leer",
    "con marcas de tiza formando un círculo ritual",
    "donde el agua de un charco refleja otro cielo",
    "con una vitrina llena de objetos sin etiquetar",
    "con cables colgando que aún chispean",
    "donde las estatuas parecen haber cambiado de posición",
    "con un cuadro cuyo marco no encierra ninguna imagen",
    "con un reloj cuyas manecillas giran al revés",
    "donde la niebla se acumula en formas definidas",
    "con una puerta enterrada a medias en el suelo",
    "con inscripciones que solo se leen bajo cierta luz",
];

const PALETAS = [
    "tonos fríos azul-grises", "naranjas y ocres cálidos", "verde musgo y sepia",
    "morados y cianes neón", "blanco y negro con toques rojos",
    "dorados y sombras profundas", "pasteles desgastados", "índigo y ámbar",
    "monocromático con accent cyan", "terra cotta y azul noche",
    "verdes fosforescentes sobre negro", "rosas y grises industriales",
    "carmín y hueso envejecido", "azul cobalto y oro",
    "gris cemento y naranja neón", "lavanda y verde salvia",
    "negro profundo y dorado envejecido", "turquesa y coral",
    "amarillo mostaza y azul marino", "blanco roto y sombras cálidas",
    "añil profundo y plata envejecida", "rojo óxido y negro carbón",
    "verde botella y cobre oscuro", "blanco hueso y gris ceniza",
    "violeta eléctrico y negro tinta", "ámbar cálido y marrón tierra",
    "cian pálido y blanco frío", "borgoña y dorado apagado",
    "gris perla y azul acero", "verde ácido y negro asfalto",
    "sepia desvaído y crema", "rosa polvo y gris paloma",
    "negro absoluto con vetas rojas", "azul medianoche y plata lunar",
    "ocre quemado y sombra profunda", "verde esmeralda y negro lacado",
    "blanco frío y azul hielo", "marrón chocolate y dorado viejo",
    "gris humo y naranja tenue", "violeta profundo y negro carbón",
    "coral desvaído y turquesa apagado", "beige cálido y marrón óxido",
    "azul petróleo y cobre brillante", "verde jade y negro mate",
    "rosa envejecido y gris plomo", "amarillo pálido y azul profundo",
    "granate oscuro y crema envejecida", "cian eléctrico y negro absoluto",
    "verde oliva y ocre polvoriento", "azul grisáceo y blanco marfil",
    "naranja quemado y morado profundo", "plata fría y azul cobalto",
    "verde menta y rosa chicle", "azul eléctrico y amarillo ácido",
    "burdeos y verde botella", "cobre envejecido y turquesa opaco",
    "gris grafito y naranja óxido", "lila pálido y gris carbón",
    "rojo carmesí y negro profundo", "verde lima y morado oscuro",
    "dorado rosa y azul petróleo", "blanco hueso y negro mate",
    "salmón desvaído y azul grisáceo", "verde pino y crema amarillento",
    "magenta apagado y verde azulado", "ámbar oscuro y azul noche",
    "rosa neón y negro absoluto", "caqui y rojo óxido",
    "azul hielo y dorado pálido", "vino tinto y beige cálido",
    "verde esmeralda y rosa polvo", "gris azulado y coral suave",
];

const HORA_DIA = [
    "madrugada (2-4am)", "amanecer", "mañana temprana", "mediodía", "tarde",
    "hora dorada", "crepúsculo", "noche cerrada", "medianoche exacta",
    "hora azul (justo antes del alba)", "sol de medianoche", "oscuridad total",
    "hora bruja (madrugada profunda)", "penumbra vespertina",
    "mediodía brumoso", "ocaso prolongado", "amanecer nublado",
    "tarde de otoño", "atardecer de invierno", "última hora de la tarde",
    "primeras luces del día", "media mañana", "siesta de mediodía",
    "última luz antes de la noche", "noche sin luna", "noche de luna llena",
    "amanecer rojizo", "tarde tormentosa", "instante exacto del ocaso",
    "madrugada de niebla", "hora del lobo (3-4am)", "tarde dorada de verano",
];

const ENFOQUE = [
    "gran angular — entorno completo", "plano medio — objeto central",
    "primer plano — detalle de textura", "vista aérea — desde arriba",
    "vista en picado — desde el suelo", "perspectiva dramática — ángulo bajo",
    "vista isométrica", "plano holandés — inclinado",
    "ojo de pez — distorsión extrema", "macro — detalle microscópico",
    "contrapicado dramático", "cenital puro", "perspectiva de túnel",
    "primer plano extremo — textura de piel", "plano secuencia imaginario",
    "simetría central perfecta", "vista en tres cuartos", "encuadre asimétrico",
    "profundidad de campo extrema", "perspectiva forzada",
    "plano cenital extremo", "plano contrapicado extremo", "vista subjetiva en primera persona",
    "plano detalle — objeto solo", "vista panorámica 360°", "plano americano",
    "encuadre a través de un marco natural", "toma con lente tilt-shift (miniatura)",
    "vista desde un dron a baja altura", "perspectiva de gusano (extreme low angle)",
];

const ILUMINACION = [
    "luz volumétrica lateral", "contraluz duro", "luz de relleno suave difusa",
    "iluminación de un solo punto", "luz neón de colores",
    "luz de fuego parpadeante", "luz de pantalla fría",
    "rayos de sol entre rendijas", "bioluminiscencia ambiental",
    "oscuridad casi total con accent de luz", "luz de luna filtrada",
    "flashes de relámpago", "luz submarina distorsionada", "reflejos en charcos",
    "luz estroboscópica intermitente", "resplandor de pantallas múltiples",
    "luz cenital dramática", "contraluz de tormenta",
    "iluminación práctica de velas múltiples", "destello único de cámara",
    "luz filtrada por cortinas rotas", "brillo residual radiactivo",
    "luz de neón parpadeante distante", "sombras proyectadas alargadas",
    "luz difusa de niebla espesa", "reflejos dobles en cristal",
    "luz rasante de amanecer", "iluminación de faro giratorio",
    "luz interior filtrándose por rendijas", "resplandor de brasas moribundas",
    "luz de emergencia roja intermitente", "haz de linterna atravesando polvo",
    "luz cálida de farolas de sodio", "iluminación fluorescente parpadeante",
    "resplandor de una pantalla en la oscuridad", "luz reflejada en agua en movimiento",
    "contraluz total (silueta pura)", "luz dorada filtrada por hojas",
    "iluminación de estudio de tres puntos", "luz de bengala roja",
    "destellos de una tormenta lejana", "luz azulada de un iceberg",
    "resplandor de un incendio distante", "luz cenital de un tragaluz único",
];

const PROP_DESTACADO = [
    "una silla volcada", "un teléfono descolgado", "una maleta abierta y vacía",
    "un libro con páginas quemadas", "una llave oxidada sobre el suelo",
    "un reloj de pared detenido", "una taza de café a medio tomar",
    "una fotografía borrosa enmarcada", "un mapa con marcas en rojo",
    "una vela a punto de apagarse", "una máscara de gas en el suelo",
    "una flor fresca en un lugar inhóspito", "una muñeca rota mirando al frente",
    "una linterna titilante", "un espejo con algo escrito",
    "una caja fuerte abierta y vacía", "un instrumento musical abandonado",
    "una pila de cartas sin enviar",
    "un ventilador de techo girando en vacío", "una radio a volumen bajo con estática",
    "un cuaderno con páginas arrancadas", "un par de zapatos abandonados en el suelo",
    "un cartel a medio caer", "una jaula de pájaros vacía balanceándose",
    "una vela consumida hasta la base", "un teléfono de disco descolgado",
    "un reloj de bolsillo detenido a una hora exacta", "un juguete de cuerda que se mueve solo",
    "un frasco de vidrio con algo dentro", "un cuadro cuya figura mira al espectador",
    "una pecera vacía con agua turbia", "un violín sin cuerdas apoyado en un rincón",
    "un paraguas roto abierto en interior", "una vieja máquina de escribir con una hoja a medias",
    "un termómetro con el mercurio al máximo", "una brújula que gira sin detenerse",
    "un candelabro con velas de distintos tamaños", "una caja de música que suena sola",
    "un abrigo colgado sin dueño aparente", "un tablero de ajedrez a mitad de partida",
    "una máscara ceremonial colgada en la pared", "un globo terráqueo desactualizado",
    "una vieja cámara fotográfica con carrete", "un títere colgando de sus hilos",
    "un farol de aceite todavía encendido", "una colección de llaves sin puertas",
    "un tocadiscos reproduciendo en silencio", "un telescopio apuntando a la nada",
    "una carta sellada nunca entregada", "un par de guantes de cuero gastados",
    "una vitrina con insectos disecados", "un reloj de sol cubierto de musgo",
    "una radio de onda corta encendida", "un cuaderno de bitácora abierto",
    "una campana de buzo oxidada", "un teléfono público sonando sin nadie cerca",
];

const ESTADO_CLIMA = [
    "nieve que cae dentro del espacio", "lluvia que se filtra por el techo",
    "polvo en suspensión permanente", "niebla baja que cubre el suelo",
    "ceniza que cae lentamente", "agua estancada en el suelo",
    "viento que mueve objetos invisibles", "vapor que emerge de las grietas",
    "granizo que rebota en silencio", "pétalos que caen sin fuente visible",
    "chispas eléctricas en el aire",
    "relámpagos silenciosos en la distancia", "calima que difumina el horizonte",
    "rocío que no se seca", "aire quieto y pesado",
    "remolinos de polvo aislados", "escarcha que cubre cada superficie",
    "humedad que empaña cualquier vidrio", "hojas secas arrastradas en círculos",
    "gotas de condensación resbalando por muros", "arena fina filtrándose entre grietas",
    "niebla que se mueve contra el viento", "lluvia que sube en vez de caer",
    "nieve negra cayendo lentamente", "vapor con olor a azufre",
    "rocío luminiscente sobre las superficies", "polen dorado flotando en el aire",
    "hojas que giran en espiral sin viento", "cenizas que brillan como luciérnagas",
    "bruma que se aferra al suelo", "escarcha que se forma en segundos",
];

const ESTILOS_VISUALES_LEGACY = [
    "Realista", "Fotorrealismo", "Hyperrealistic", "Cinematic 3D",
    "Low Poly", "Voxel", "Pixel Art 3D", "Retro PSX", "N64 / PS1",
    "Painterly", "Oil Painting 3D", "Acuarela digital", "Gouache",
    "Cel Shading", "Toon Shader", "Estilo manga", "Comic book",
    "Noir", "Gotham noir", "Dark Fantasy", "Horror atmosférico",
    "Gothic", "Grimdark", "Mist & Fog",
    "Cyberpunk", "Sci-fi Hard", "Solarpunk", "Atompunk",
    "Dieselpunk", "Biopunk", "Space Opera",
    "Dreamcore", "Weirdcore", "Liminal Space", "Surrealist 3D",
    "Psychedelic", "Glitchcore",
    "Studio Ghibli", "Wes Anderson", "Ukiyo-e 3D",
    "Soviet Brutalism", "Latin Folklore",
    "Art Nouveau", "Art Deco", "Bauhaus 3D", "Constructivista",
    "Expressionista", "Impresionista 3D", "Renacentista digital",
    "Cubista 3D", "Futurista", "Dadaísta", "Suprematista",
    "De Stijl", "Minimalismo extremo", "Brutalismo digital",
    "Arte conceptual", "Matte Painting", "Environment Art", "Keyframe Art",
];

const ESTETICAS = {
    realista: {
        nombre: "Realista / Cinematográfico", icono: "🎥",
        paletaHex: ["#3b3a36", "#8a7b6c", "#c9b79c", "#4d5b5f", "#1f1c19"],
        hardExclude: {
            modificadores: ["fracturada", "cristalizada", "distorsionada", "invertida", "fractal"],
            atmosferas: ["en un plano astral", "en una dimensión en colapso", "bajo una lluvia ácida", "en un bucle temporal"],
        },
        extra: {
            modificadores: ["documental", "cotidiana", "texturizada", "verosímil", "tangible"],
            atmosferas: ["bajo luz natural difusa", "en un día nublado ordinario", "con grano de película de 35mm"],
            iluminacion: ["luz natural de ventana", "hora dorada realista", "luz de práctico ambiental"],
            paletas: ["tonos naturales desaturados", "paleta documental cálida"],
        },
    },
    retro: {
        nombre: "Retro Game / Low Poly", icono: "🕹️",
        paletaHex: ["#0f380f", "#9bbc0f", "#306230", "#e0d068", "#3050c0"],
        hardExclude: { modificadores: ["nauseabunda", "descarnada"] },
        extra: {
            modificadores: ["pixelada", "poligonal", "cuantizada", "retroiluminada"],
            atmosferas: ["con dithering visible", "bajo un cielo de gradiente de 4 colores", "con niebla de distancia de render"],
            iluminacion: ["luz plana sin sombras suaves", "iluminación de sprite", "brillo de CRT"],
            paletas: ["paleta de 16 colores tipo NES", "verde fósforo de Game Boy", "CGA magenta y cian"],
        },
    },
    pintura: {
        nombre: "Ilustración Pintada", icono: "🎨",
        paletaHex: ["#8b5a2b", "#c99a52", "#4a3728", "#e8c88a", "#2e2418"],
        hardExclude: { modificadores: ["mecánica", "fractal"] },
        extra: {
            modificadores: ["pincelada", "empastada"],
            atmosferas: ["con pinceladas visibles en el cielo", "bajo una luz difusa de estudio", "con veladuras translúcidas"],
            iluminacion: ["luz de claroscuro pictórico", "luz cálida de taller"],
            paletas: ["ocres y siena tostado", "paleta de veladuras translúcidas", "tonos terrosos de óleo"],
        },
    },
    anime: {
        nombre: "Anime / Toon", icono: "🌸",
        paletaHex: ["#ffb6c1", "#87ceeb", "#fff2cc", "#ff8fab", "#6ec6ff"],
        hardExclude: { modificadores: ["descarnada", "nauseabunda", "corrupta"] },
        extra: {
            modificadores: ["saturada", "expresiva"],
            atmosferas: ["con pétalos de cerezo flotando", "bajo un cielo de acuarela", "con destellos de lente exagerados"],
            complementos: ["con partículas de luz brillante flotando", "con un halo de brillo alrededor de una figura ausente"],
            paletas: ["pastel saturado", "cian y magenta luminoso", "rosa sakura y cielo azul"],
        },
    },
    noir: {
        nombre: "Noir / Misterio", icono: "🕵️",
        paletaHex: ["#0a0a0a", "#3a3a3a", "#c9c9c9", "#8b0000", "#1a1a1a"],
        hardExclude: {
            modificadores: ["translúcida", "fosforescente", "orgánica"],
            paletas: ["pastel saturado", "rosa sakura y cielo azul"],
        },
        extra: {
            modificadores: ["sombría"],
            atmosferas: ["bajo una única farola parpadeante", "entre persianas venecianas", "con humo de tabaco suspendido"],
            iluminacion: ["claroscuro de alto contraste", "sombras de persiana proyectadas", "luz dura de una sola bombilla"],
            paletas: ["blanco y negro con un solo acento rojo", "grises de humo y sombra"],
        },
    },
    terror: {
        nombre: "Terror", icono: "🩸",
        paletaHex: ["#1a0000", "#3d0000", "#0d0d0d", "#4a0e0e", "#8b0000"],
        lugaresEvitar: ["un jardín zen", "una tienda de antigüedades"],
        hardExclude: {
            modificadores: ["reluciente", "simétrica"],
            atmosferas: ["con pétalos de cerezo flotando", "bajo una aurora boreal", "con destellos de lente exagerados"],
            paletas: ["pastel saturado", "rosa sakura y cielo azul", "paleta de 16 colores tipo NES"],
        },
        extra: {
            modificadores: [
                "visceral", "putrefacta", "agonizante", "deforme", "profanada", "poseída",
                "mutilada", "corroída", "profanadora", "abyecta", "atroz", "malsana",
            ],
            estados: {
                m: [
                    "cubierto de manchas oscuras", "infestado de algo innombrable", "latiendo débilmente",
                    "manchado de un líquido oscuro", "envuelto en un hedor pútrido",
                ],
                f: [
                    "cubierta de manchas oscuras", "infestada de algo innombrable", "latiendo débilmente",
                    "manchada de un líquido oscuro", "envuelta en un hedor pútrido",
                ],
            },
            atmosferas: [
                "con susurros indistinguibles en el aire", "bajo un silencio que precede al horror",
                "con sombras que se mueven contra la luz", "con un frío que no debería estar ahí",
                "con la sensación de ser observado desde todos los ángulos",
            ],
            complementos: [
                "con arañazos profundos en las paredes", "con una silueta que no debería estar ahí",
                "con un llanto lejano sin origen aparente", "con marcas de dedos ensangrentados en una puerta",
                "con una figura inmóvil de pie en la esquina más oscura",
            ],
            iluminacion: [
                "luz de linterna temblorosa", "oscuridad casi total con destellos súbitos",
                "luz roja de emergencia parpadeante", "un único foco fundiéndose intermitentemente",
            ],
            paletas: [
                "rojo sangre seca y negro", "verde enfermizo y gris cadavérico",
                "negro absoluto con vetas rojas", "gris ceniciento y marrón podrido",
            ],
        },
    },
    cyberpunk: {
        nombre: "Cyberpunk / Sci-fi", icono: "🤖",
        paletaHex: ["#0d0221", "#ff2079", "#00fff0", "#1a1a2e", "#f6019d"],
        hardExclude: {
            modificadores: ["milenaria", "artesanal", "sagrada"],
            paletas: ["ocres y siena tostado", "tonos terrosos de óleo"],
        },
        extra: {
            modificadores: ["holográfica", "sobrecargada de cables", "aumentada"],
            atmosferas: ["bajo un cielo saturado de anuncios holográficos", "entre la lluvia ácida de neón", "con drones sobrevolando en la niebla"],
            complementos: ["con pantallas parpadeando código ilegible", "con un letrero de neón a medio fundir", "con cables colgando como enredaderas artificiales"],
            iluminacion: ["neón rosa y cian cruzados", "resplandor de pantallas múltiples", "luz fría de tubos LED"],
            paletas: ["neón cian y magenta sobre negro", "morado eléctrico y ámbar sintético"],
        },
    },
    solarpunk: {
        nombre: "Solarpunk / Utopía", icono: "🌿",
        paletaHex: ["#7fb069", "#f4d35e", "#2d6a4f", "#e9f5db", "#40916c"],
        lugaresEvitar: ["una prisión", "una cripta", "un cementerio de máquinas"],
        hardExclude: {
            modificadores: ["corrupta", "herrumbrada", "putrefacta", "agonizante"],
            paletas: ["rojo sangre seca y negro", "verde enfermizo y gris cadavérico"],
        },
        extra: {
            modificadores: ["floreciente", "restaurada", "cultivada"],
            atmosferas: ["bajo paneles solares translúcidos", "entre jardines verticales en flor", "con luciérnagas artificiales al anochecer"],
            complementos: ["con enredaderas creciendo sobre estructuras recicladas", "con paneles solares integrados en cada superficie", "con colmenas urbanas activas"],
            paletas: ["verde vivo y dorado solar", "turquesa y blanco reciclado"],
        },
    },
    onirico: {
        nombre: "Onírico / Surreal", icono: "🌀",
        paletaHex: ["#b967ff", "#ff6ec7", "#00f5d4", "#ffea00", "#2b1055"],
        hardExclude: {
            modificadores: ["documental", "verosímil", "tangible"],
            atmosferas: ["con grano de película de 35mm"],
        },
        extra: {
            modificadores: ["onírica", "imposible", "repetida infinitamente"],
            estados: {
                m: ["desdoblándose sobre sí mismo", "cambiando de escala sin razón"],
                f: ["desdoblándose sobre sí misma", "cambiando de escala sin razón"],
            },
            atmosferas: ["en un cielo de colores imposibles", "donde el horizonte se curva hacia arriba", "con múltiples soles pequeños"],
            complementos: ["con escaleras que llevan a ningún lugar y a todos a la vez", "con puertas flotando sin marco", "con relojes derritiéndose sobre superficies"],
            iluminacion: ["luz sin fuente aparente", "luz que cambia de color al mirarla"],
            paletas: ["violeta eléctrico y negro tinta", "rosa imposible y verde ácido"],
        },
    },
    artdeco: {
        nombre: "Art Déco / Nouveau", icono: "🏛️",
        paletaHex: ["#0b0b0b", "#c9a227", "#0f4c3a", "#e0c68f", "#1a1a1a"],
        hardExclude: { modificadores: ["herrumbrada", "putrefacta", "pixelada"] },
        extra: {
            modificadores: ["ornamentada", "bañada en oro"],
            atmosferas: ["bajo lámparas de líneas geométricas doradas", "con vitrales de formas florales estilizadas"],
            complementos: ["con motivos de abanico dorado en el techo", "con barandales de hierro forjado sinuoso"],
            paletas: ["negro lacado y dorado", "esmeralda y plata bruñida"],
        },
    },
    vanguardia: {
        nombre: "Vanguardia Artística", icono: "🔺",
        paletaHex: ["#e63946", "#1d1d1d", "#f1faee", "#457b9d", "#f4a300"],
        hardExclude: { modificadores: ["documental", "cotidiana"] },
        extra: {
            modificadores: ["fragmentada", "deconstruida", "dislocada"],
            atmosferas: ["con perspectivas múltiples simultáneas", "bajo un cielo de formas geométricas puras", "con colores en bloques planos"],
            complementos: ["con formas superpuestas sin lógica espacial", "con líneas diagonales que dividen la composición"],
            paletas: ["rojo, negro y blanco constructivista", "bloques primarios puros"],
        },
    },
    folklore: {
        nombre: "Folklore / Cultural", icono: "🌾",
        paletaHex: ["#c1440e", "#e8a33d", "#2a6f77", "#f2e3c6", "#7a2e2e"],
        hardExclude: { modificadores: ["holográfica", "futurista"] },
        extra: {
            modificadores: ["ceremonial", "ancestral"],
            atmosferas: ["durante una celebración tradicional", "con humo de incienso ceremonial", "bajo banderines de colores ondeando"],
            complementos: ["con textiles bordados colgando de las paredes", "con instrumentos tradicionales apoyados en un rincón"],
            paletas: ["rojo terracota y turquesa", "ocre y añil tradicional"],
        },
    },
    steampunk: {
        nombre: "Steampunk", icono: "🎩",
        paletaHex: ["#8b5a2b", "#3e2723", "#4e342e", "#2e5339", "#c9a05c"],
        hardExclude: { modificadores: ["holográfica", "sintética", "cuántica", "futurista"] },
        extra: {
            modificadores: ["mecanizada", "engranada", "remachada", "a vapor"],
            atmosferas: ["entre nubes de vapor y hollín", "bajo el zumbido de engranajes gigantes", "iluminada por lámparas de gas"],
            complementos: ["con tuberías de cobre serpenteando por las paredes", "con engranajes expuestos girando sin parar", "con un dirigible visible a través de una claraboya"],
            iluminacion: ["luz de lámparas de gas parpadeantes", "resplandor de calderas encendidas"],
            paletas: ["cobre bruñido y cuero envejecido", "latón oscuro y verde botella"],
        },
    },
    postapocaliptico: {
        nombre: "Post-apocalíptico", icono: "☢️",
        paletaHex: ["#5c5347", "#8b4513", "#3a3a2c", "#c9a227", "#2b2b2b"],
        lugaresEvitar: ["un jardín zen", "una capilla"],
        hardExclude: {
            modificadores: ["reluciente", "sagrada", "cristalina"],
            paletas: ["pastel saturado", "rosa sakura y cielo azul"],
        },
        extra: {
            modificadores: ["saqueada", "irradiada", "chatarrizada", "improvisada"],
            atmosferas: ["bajo un cielo permanentemente ocre", "entre tormentas de arena radiactiva", "bajo el silencio de una ciudad muerta"],
            complementos: ["con barricadas improvisadas de chatarra", "con carteles de advertencia radiactiva oxidados", "con vehículos abandonados cubiertos de óxido"],
            paletas: ["ocre radiactivo y gris ceniza", "óxido profundo y amarillo tóxico"],
        },
    },
    fantasiaepica: {
        nombre: "Fantasía Épica / Medieval", icono: "⚔️",
        paletaHex: ["#2d4a2b", "#8b6914", "#5c1a1a", "#6b6459", "#c9a227"],
        hardExclude: { modificadores: ["sintética", "holográfica", "cuántica", "futurista"] },
        extra: {
            modificadores: ["rúnica", "consagrada", "legendaria", "forjada en batalla"],
            atmosferas: ["bajo estandartes ondeando al viento", "durante el asedio de una fortaleza", "iluminada por antorchas de guardia"],
            complementos: ["con escudos y espadas colgados en las paredes", "con un trono vacío al fondo", "con estandartes heráldicos colgando del techo"],
            paletas: ["verde bosque y dorado real", "borgoña profundo y piedra gris"],
        },
    },
    spaceopera: {
        nombre: "Space Opera / Sci-fi Espacial", icono: "🚀",
        paletaHex: ["#0a1128", "#e0e0e0", "#ff6b35", "#1b3a4b", "#c0c0c0"],
        hardExclude: { modificadores: ["artesanal", "ancestral"] },
        extra: {
            modificadores: ["blindada", "propulsada", "hipertecnológica"],
            atmosferas: ["bajo la luz de una nebulosa distante", "flotando en gravedad cero", "entre los restos de una batalla espacial"],
            complementos: ["con paneles de control parpadeando en la oscuridad", "con ventanas panorámicas mostrando el espacio profundo", "con robots de mantenimiento trabajando en silencio"],
            paletas: ["azul espacial profundo y blanco nave", "naranja propulsor y gris metálico"],
        },
    },
    western: {
        nombre: "Western / Frontera", icono: "🤠",
        paletaHex: ["#c19a6b", "#8b4513", "#d2691e", "#4a3728", "#e8a33d"],
        hardExclude: { modificadores: ["futurista", "holográfica", "sintética", "cuántica"] },
        extra: {
            modificadores: ["curtida", "árida", "fronteriza"],
            atmosferas: ["bajo un sol abrasador de mediodía", "entre remolinos de polvo del desierto", "al atardecer sobre la pradera"],
            complementos: ["con un poste de amarre desgastado por el uso", "con letreros de madera desteñidos por el sol", "con rodadura de heno cruzando el paisaje"],
            paletas: ["ocre desierto y cuero curtido", "rojo atardecer y marrón polvoriento"],
        },
    },
};

const ESTETICA_IDS = Object.keys(ESTETICAS);

let CUSTOM_VOCAB = {};

function poolCategoria(general, esteticaId, categoria, fuerza, customExtra, usedSet) {
    const withCustom = (customExtra && customExtra.length) ? general.concat(customExtra) : general;
    const est = ESTETICAS[esteticaId];
    let base;
    if (!est) {
        base = withCustom;
    } else {
        const hardEx = new Set((est.hardExclude && est.hardExclude[categoria]) || []);
        const filtered = withCustom.filter((w) => !hardEx.has(w));
        const usarCurado = Math.random() * 100 < fuerza;
        if (usarCurado) {
            const extra = (est.extra && est.extra[categoria]) || [];
            const curado = filtered.concat(extra);
            base = curado.length ? curado : filtered;
        } else {
            base = filtered.length ? filtered : withCustom;
        }
    }
    if (usedSet && usedSet.size) {
        const remaining = base.filter((w) => !usedSet.has(w));
        if (remaining.length) return remaining;
    }
    return base;
}

function pickCategoria(general, esteticaId, categoria, fuerza, customExtra, usedSet) {
    const chosen = pick(poolCategoria(general, esteticaId, categoria, fuerza, customExtra, usedSet));
    if (usedSet) usedSet.add(chosen);
    return chosen;
}

function pickSimple(general, customExtra, usedSet) {
    let pool = (customExtra && customExtra.length) ? general.concat(customExtra) : general;
    if (usedSet && usedSet.size) {
        const remaining = pool.filter((w) => !usedSet.has(w));
        if (remaining.length) pool = remaining;
    }
    const chosen = pick(pool);
    if (usedSet) usedSet.add(chosen);
    return chosen;
}

function pickEstado(genero, esteticaId, fuerza, usedSet) {
    const general = ESTADOS[genero];
    const est = ESTETICAS[esteticaId];
    let base;
    if (!est) {
        base = general;
    } else {
        const hardEx = new Set((est.hardExclude && est.hardExclude.estados && est.hardExclude.estados[genero]) || []);
        const filtered = general.filter((w) => !hardEx.has(w));
        const usarCurado = Math.random() * 100 < fuerza;
        if (usarCurado) {
            const extra = (est.extra && est.extra.estados && est.extra.estados[genero]) || [];
            const curado = filtered.concat(extra);
            base = curado.length ? curado : filtered;
        } else {
            base = filtered.length ? filtered : general;
        }
    }
    if (usedSet && usedSet.size) {
        const remaining = base.filter((w) => !usedSet.has(w));
        if (remaining.length) base = remaining;
    }
    const chosen = pick(base);
    if (usedSet) usedSet.add(chosen);
    return chosen;
}

function pickHex(esteticaId) {
    const est = ESTETICAS[esteticaId];
    const pool = (est && est.paletaHex) || ["#888888", "#cccccc", "#444444", "#aaaaaa"];
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(4, shuffled.length));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

const CONCORDAR_INVARIANTES = new Set([
    "colosal", "flotante", "susurrante", "monumental", "atemporal",
    "espectral", "fractal", "nómada", "latente", "insondable",
    "itinerante", "palpitante", "inerte", "precaria", "sitiada",
    "custodiada",
]);

function concordar(mod, genero) {
    if (mod.includes(" ")) return mod;
    if (mod.endsWith("ista")) return mod;
    if (CONCORDAR_INVARIANTES.has(mod)) return mod;
    if (genero === "m" && mod.endsWith("a")) return mod.slice(0, -1) + "o";
    if (genero === "f" && mod.endsWith("o")) return mod.slice(0, -1) + "a";
    return mod;
}

function parsearLugaresCustom(texto) {
    const items = texto.split(",").map((t) => t.trim()).filter(Boolean);
    if (!items.length) return null;

    const resultado = [];
    for (const item of items) {
        const itemLower = item.toLowerCase();
        const match = LUGARES_BASE.find(([l]) =>
            itemLower.includes(l.toLowerCase()) || l.toLowerCase().includes(itemLower)
        );
        if (match) {
            resultado.push(match);
            continue;
        }
        let genero;
        if (itemLower.startsWith("una ") || itemLower.startsWith("la ")) genero = "f";
        else if (itemLower.startsWith("un ") || itemLower.startsWith("el ")) genero = "m";
        else genero = itemLower.replace(/s$/, "").endsWith("a") ? "f" : "m";

        let lugar = item;
        if (!/^(un |una |el |la )/.test(itemLower)) {
            lugar = (genero === "f" ? "una " : "un ") + item;
        }
        resultado.push([lugar, genero]);
    }
    return resultado.length ? resultado : null;
}

function generarEscena(opts = {}) {
    const n = Math.max(1, Math.min(20, parseInt(opts.n, 10) || 5));
    const lugaresCustom = (opts.lugares || "").trim() || null;
    const esteticaSel = opts.estetica || "aleatoria";
    const fuerza = Math.max(0, Math.min(100, parseInt(opts.fuerza, 10) || 0));
    const extras = opts.extras || {};
    const densidad = Math.max(0, Math.min(1, parseFloat(opts.densidad) || 0.7));

    const escenas = [];
    const lugaresUsados = new Set();
    const poolCustom = lugaresCustom ? parsearLugaresCustom(lugaresCustom) : null;
    const lugaresBaseConCustom = LUGARES_BASE;

    const usados = {
        modificadores: new Set(), atmosferas: new Set(), complementos: new Set(),
        estadosM: new Set(), estadosF: new Set(),
        paletas: new Set(), hora: new Set(), enfoque: new Set(),
        iluminacion: new Set(), prop: new Set(), clima: new Set(),
    };

    for (let i = 0; i < n; i++) {
        const esteticaId = esteticaSel === "aleatoria" ? pick(ESTETICA_IDS) : esteticaSel;
        const est = ESTETICAS[esteticaId] || ESTETICAS[ESTETICA_IDS[0]];

        let lugar, genero;
        if (poolCustom) {
            [lugar, genero] = pick(poolCustom);
        } else {
            let candidatos = lugaresBaseConCustom.filter(([l]) => !lugaresUsados.has(l));
            if (est.lugaresEvitar && est.lugaresEvitar.length && fuerza > 50) {
                const evitarSet = new Set(est.lugaresEvitar);
                const sinEvitar = candidatos.filter(([l]) => !evitarSet.has(l));
                if (sinEvitar.length) candidatos = sinEvitar;
            }
            if (!candidatos.length) candidatos = lugaresBaseConCustom;
            [lugar, genero] = pick(candidatos);
        }
        lugaresUsados.add(lugar);

        const partes = [];
        if (Math.random() > 0.1 + (1 - densidad) * 0.3) {
            const modCrudo = pickCategoria(MODIFICADORES, esteticaId, "modificadores", fuerza, CUSTOM_VOCAB.modificadores, usados.modificadores);
            const mod = concordar(modCrudo, genero);
            const palabras = lugar.split(" ");
            partes.push(`${palabras[0]} ${palabras.slice(1).join(" ")} ${mod}`);
        } else {
            partes.push(lugar);
        }

        if (Math.random() > Math.max(0.05, 0.5 - densidad * 0.4)) {
            partes.push(pickEstado(genero, esteticaId, fuerza, genero === "f" ? usados.estadosF : usados.estadosM));
        }
        if (Math.random() > Math.max(0.05, 0.35 - densidad * 0.3)) {
            partes.push(pickCategoria(ATMOSFERAS, esteticaId, "atmosferas", fuerza, CUSTOM_VOCAB.atmosferas, usados.atmosferas));
        }
        if (Math.random() < densidad * 0.6) {
            partes.push(pickCategoria(COMPLEMENTOS, esteticaId, "complementos", fuerza, CUSTOM_VOCAB.complementos, usados.complementos));
        }

        let frase;
        if (partes.length === 1) frase = partes[0];
        else if (partes.length === 2) frase = `${partes[0]} ${partes[1]}`;
        else frase = partes.slice(0, -1).join(", ") + " " + partes[partes.length - 1];

        const escena = { escena: capitalize(frase) };
        escena.estetica = est.nombre;
        escena.esteticaIcono = est.icono;

        if (extras.paleta !== false) {
            escena.paleta = capitalize(pickCategoria(PALETAS, esteticaId, "paletas", fuerza, CUSTOM_VOCAB.paletas, usados.paletas));
            escena.paletaHex = pickHex(esteticaId);
        }
        if (extras.hora !== false) {
            escena.hora = capitalize(pickSimple(HORA_DIA, CUSTOM_VOCAB.hora_dia, usados.hora));
        }
        if (extras.enfoque !== false) {
            escena.enfoque = capitalize(pickSimple(ENFOQUE, CUSTOM_VOCAB.enfoque, usados.enfoque));
        }
        if (extras.iluminacion) {
            escena.iluminacion = capitalize(pickCategoria(ILUMINACION, esteticaId, "iluminacion", fuerza, CUSTOM_VOCAB.iluminacion, usados.iluminacion));
        }
        if (extras.prop) {
            escena.prop = capitalize(pickSimple(PROP_DESTACADO, CUSTOM_VOCAB.prop_destacado, usados.prop));
        }
        if (extras.clima) {
            escena.clima = capitalize(pickSimple(ESTADO_CLIMA, CUSTOM_VOCAB.estado_clima, usados.clima));
        }
        if (extras.estiloVisual) {
            escena.estiloVisualTag = pick(ESTILOS_VISUALES_LEGACY);
        }

        escenas.push(escena);
    }

    return escenas;
}

// ══════════════════════════════════════════════════════════════════════
//  PARTE 2: capa de UI mobile (adaptada -- desktop tiene un layout de dos
//  columnas con panel de opciones fijo a la izquierda; acá todo es una
//  columna, con el panel de opciones colapsable para dejarle lugar a los
//  resultados en una pantalla chica).
//
//  A propósito NO portado de escritorio (recorte de alcance): el
//  config.json editable desde Settings (valores por defecto y vocabulario
//  personalizado por categoría) -- acá se usan los mismos defaults de
//  siempre directamente. "Guardados" sí se persiste (ver scene_prompts.rs),
//  pero via un comando propio en vez de fs_read_file/fs_write_file
//  genéricos (que no existen en mobile).
// ══════════════════════════════════════════════════════════════════════
registerRenderer("scene", {
    render(tool, area) {
        const root = el("div", { className: "sg-root" });
        area.appendChild(root);

        const TAG_META = {
            paleta: { icon: "🖌" }, hora: { icon: "🕐" }, enfoque: { icon: "📷" },
            iluminacion: { icon: "💡" }, prop: { icon: "📦" }, clima: { icon: "🌧" },
            estiloVisualTag: { icon: "🎲" },
        };

        const S = {
            view: "gen", // gen | saved
            showOptions: true,
            count: 5,
            densidad: 0.7,
            lugar: "",
            estetica: "aleatoria",
            fuerza: 75,
            extras: { paleta: true, hora: true, enfoque: true, iluminacion: false, prop: false, clima: false, estiloVisual: false },
            scenes: [],
            saved: [],
            copiedAll: false,
        };

        function sceneCopyText(sc) {
            return [
                sc.escena,
                `${sc.esteticaIcono || ""} ${sc.estetica}`,
                ...Object.entries(TAG_META).filter(([k]) => sc[k]).map(([k, m]) => `${m.icon} ${sc[k]}`),
                sc.paletaHex ? `🎨 ${sc.paletaHex.join(", ")}` : null,
            ].filter(Boolean).join("\n");
        }

        function isSaved(sc) {
            return S.saved.some(s => s.escena === sc.escena && s.estetica === sc.estetica);
        }

        async function persistSaved() {
            try { await invoke("scene_prompts_save_all", { items: S.saved }); } catch (e) { /* best effort */ }
        }

        async function loadSaved() {
            try { S.saved = await invoke("scene_prompts_list"); } catch (e) { S.saved = []; }
            renderView();
        }

        function generate() {
            S.scenes = generarEscena({
                n: S.count, lugares: S.lugar, estetica: S.estetica,
                fuerza: S.fuerza, densidad: S.densidad, extras: S.extras,
            });
            S.view = "gen";
            S.showOptions = false;
            renderView();
        }

        async function saveScene(sc) {
            if (isSaved(sc)) return;
            S.saved.unshift({ ...sc, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now() });
            await persistSaved();
            renderView();
        }

        async function deleteSaved(idx) {
            S.saved.splice(idx, 1);
            await persistSaved();
            renderView();
        }

        async function moveSaved(idx, dir) {
            const j = idx + dir;
            if (j < 0 || j >= S.saved.length) return;
            [S.saved[idx], S.saved[j]] = [S.saved[j], S.saved[idx]];
            await persistSaved();
            renderView();
        }

        function copyText(text, btn) {
            navigator.clipboard.writeText(text).catch(() => {});
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = "✓";
                setTimeout(() => { btn.textContent = orig; }, 1200);
            }
        }

        function copyAll() {
            const lines = S.scenes.map((sc, i) => `${i + 1}. ${sceneCopyText(sc)}`);
            navigator.clipboard.writeText(lines.join("\n\n")).catch(() => {});
            S.copiedAll = true;
            renderView();
            setTimeout(() => { S.copiedAll = false; renderView(); }, 1200);
        }

        function renderCard(sc, opts) {
            const card = el("div", { className: "sg-card" });
            const banner = el("div", { className: "sg-banner" });
            banner.innerHTML = `<span>${sc.esteticaIcono || "✨"}</span> ${sc.estetica}`;
            card.appendChild(banner);
            card.appendChild(el("div", { className: "sg-title", textContent: sc.escena }));

            const tags = el("div", { className: "sg-tags" });
            Object.entries(TAG_META).forEach(([k, m]) => {
                if (!sc[k]) return;
                tags.appendChild(el("span", { className: "sg-tag", textContent: `${m.icon} ${sc[k]}` }));
            });
            if (tags.children.length) card.appendChild(tags);

            if (sc.paletaHex && sc.paletaHex.length) {
                const hexRow = el("div", { className: "sg-hex-row" });
                sc.paletaHex.forEach(h => {
                    const chip = el("button", { className: "sg-hex-chip", title: h });
                    chip.style.background = h;
                    chip.onclick = () => copyText(h, null);
                    hexRow.appendChild(chip);
                });
                card.appendChild(hexRow);
            }

            const actions = el("div", { className: "sg-card-actions" });
            if (opts.savedView) {
                const upBtn = el("button", { textContent: "▲", disabled: opts.idx === 0 });
                upBtn.onclick = () => moveSaved(opts.idx, -1);
                const downBtn = el("button", { textContent: "▼", disabled: opts.idx === S.saved.length - 1 });
                downBtn.onclick = () => moveSaved(opts.idx, 1);
                const copyBtn = el("button", { textContent: "⧉ Copiar" });
                copyBtn.onclick = (e) => copyText(sceneCopyText(sc), e.currentTarget);
                const delBtn = el("button", { className: "sg-del-btn", textContent: "✕" });
                delBtn.onclick = () => deleteSaved(opts.idx);
                actions.append(upBtn, downBtn, copyBtn, delBtn);
            } else {
                const already = isSaved(sc);
                const saveBtn = el("button", { textContent: already ? "✓ Guardado" : "💾 Guardar", disabled: already });
                saveBtn.onclick = () => saveScene(sc);
                const copyBtn = el("button", { textContent: "⧉ Copiar" });
                copyBtn.onclick = (e) => copyText(sceneCopyText(sc), e.currentTarget);
                actions.append(saveBtn, copyBtn);
            }
            card.appendChild(actions);
            return card;
        }

        function renderOptions() {
            const wrap = el("div", { className: "sg-options" });

            const countRow = el("div", { className: "sg-ctrl-block" });
            countRow.appendChild(el("div", { className: "sg-ctrl-label", textContent: "CANTIDAD" }));
            const countBtns = el("div", { className: "sg-count-row" });
            [3, 5, 8, 10].forEach(n => {
                const b = el("button", { className: n === S.count ? "sg-count-btn active" : "sg-count-btn", textContent: String(n) });
                b.onclick = () => { S.count = n; renderView(); };
                countBtns.appendChild(b);
            });
            countRow.appendChild(countBtns);
            wrap.appendChild(countRow);

            const densRow = el("div", { className: "sg-ctrl-block" });
            const densLabel = el("div", { className: "sg-ctrl-label", textContent: `DENSIDAD: ${S.densidad.toFixed(1)} (${S.densidad < 0.4 ? "Simple" : S.densidad > 0.7 ? "Detallado" : "Media"})` });
            densRow.appendChild(densLabel);
            const densSlider = el("input", { type: "range", min: "0", max: "1", step: "0.1", value: String(S.densidad) });
            // NUEVO (bug real, arreglado): renderView() en "input" hace
            // root.innerHTML = "" en CADA tick de arrastre, destruyendo el
            // propio <input> que el navegador está tocando -- eso corta la
            // captura táctil nativa a mitad de gesto (solo el primer toque
            // llegaba a cambiar el valor). Ahora "input" solo actualiza el
            // texto del label, sin tocar el DOM del slider.
            densSlider.oninput = (e) => {
                S.densidad = parseFloat(e.target.value);
                densLabel.textContent = `DENSIDAD: ${S.densidad.toFixed(1)} (${S.densidad < 0.4 ? "Simple" : S.densidad > 0.7 ? "Detallado" : "Media"})`;
            };
            densRow.appendChild(densSlider);
            wrap.appendChild(densRow);

            const lugarRow = el("div", { className: "input-row" });
            const lugarInp = el("input", { type: "text", value: S.lugar, placeholder: "catedral, selva oscura... (opcional)" });
            lugarInp.oninput = (e) => { S.lugar = e.target.value; };
            lugarRow.append(lbl("Lugar"), lugarInp);
            wrap.appendChild(lugarRow);

            const estRow = el("div", { className: "input-row" });
            const estSel = el("select", {});
            estSel.appendChild(el("option", { value: "aleatoria", textContent: "🎲 Aleatoria", selected: S.estetica === "aleatoria" }));
            Object.entries(ESTETICAS).forEach(([id, e]) => {
                estSel.appendChild(el("option", { value: id, textContent: `${e.icono} ${e.nombre}`, selected: id === S.estetica }));
            });
            estSel.onchange = (e) => { S.estetica = e.target.value; };
            estRow.append(lbl("Estética"), estSel);
            wrap.appendChild(estRow);

            const fuerzaRow = el("div", { className: "sg-ctrl-block" });
            const fuerzaLabel = el("div", { className: "sg-ctrl-label", textContent: `FUERZA DE LA ESTÉTICA: ${S.fuerza}` });
            fuerzaRow.appendChild(fuerzaLabel);
            const fuerzaSlider = el("input", { type: "range", min: "0", max: "100", step: "5", value: String(S.fuerza) });
            // Mismo motivo que el slider de densidad (ver arriba): "input"
            // solo toca el label, no renderView().
            fuerzaSlider.oninput = (e) => {
                S.fuerza = parseInt(e.target.value, 10);
                fuerzaLabel.textContent = `FUERZA DE LA ESTÉTICA: ${S.fuerza}`;
            };
            fuerzaRow.appendChild(fuerzaSlider);
            wrap.appendChild(fuerzaRow);

            const checksRow = el("div", { className: "sg-ctrl-block" });
            checksRow.appendChild(el("div", { className: "sg-ctrl-label", textContent: "INCLUIR EN SUGERENCIA" }));
            const checks = el("div", { className: "sg-checks" });
            [["paleta", "🖌 Paleta de color"], ["hora", "🕐 Hora del día"], ["enfoque", "📷 Enfoque de cámara"],
             ["iluminacion", "💡 Iluminación"], ["prop", "📦 Prop destacado"], ["clima", "🌧 Estado del clima"],
             ["estiloVisual", "🎲 Estilo visual"]].forEach(([key, label]) => {
                const row = el("label", { className: "sg-check" });
                const chk = el("input", { type: "checkbox", checked: S.extras[key] });
                chk.onchange = (e) => { S.extras[key] = e.target.checked; };
                row.append(chk, el("span", { textContent: label }));
                checks.appendChild(row);
            });
            checksRow.appendChild(checks);
            wrap.appendChild(checksRow);

            const genBtn = el("button", { className: "primary sg-gen-btn", textContent: "✦ Generar escenas" });
            genBtn.onclick = generate;
            wrap.appendChild(genBtn);

            return wrap;
        }

        function renderView() {
            root.innerHTML = "";

            const tabs = el("div", { className: "sg-tabs" });
            const genTab = el("button", { className: S.view === "gen" ? "sg-tab active" : "sg-tab", textContent: "Generadas" });
            genTab.onclick = () => { S.view = "gen"; renderView(); };
            const savedTab = el("button", { className: S.view === "saved" ? "sg-tab active" : "sg-tab", textContent: `Guardados (${S.saved.length})` });
            savedTab.onclick = () => { S.view = "saved"; renderView(); };
            tabs.append(genTab, savedTab);
            root.appendChild(tabs);

            if (S.view === "gen") {
                const optToggle = el("button", { className: "sg-opt-toggle", textContent: S.showOptions ? "Ocultar opciones ▲" : "Opciones ▼" });
                optToggle.onclick = () => { S.showOptions = !S.showOptions; renderView(); };
                root.appendChild(optToggle);
                if (S.showOptions) root.appendChild(renderOptions());

                if (S.scenes.length) {
                    const toolbar = el("div", { className: "sg-result-toolbar" });
                    toolbar.appendChild(el("span", { className: "sg-result-label", textContent: `${S.scenes.length} escenas generadas` }));
                    const copyAllBtn = el("button", { textContent: S.copiedAll ? "✓ Copiado" : "Copiar todo" });
                    copyAllBtn.onclick = copyAll;
                    toolbar.appendChild(copyAllBtn);
                    root.appendChild(toolbar);

                    const grid = el("div", { className: "sg-grid" });
                    S.scenes.forEach(sc => grid.appendChild(renderCard(sc, { savedView: false })));
                    root.appendChild(grid);
                } else if (!S.showOptions) {
                    root.appendChild(el("p", { className: "sg-empty", textContent: "Generá tus primeras escenas." }));
                }
            } else {
                if (!S.saved.length) {
                    root.appendChild(el("p", { className: "sg-empty", textContent: "Sin prompts guardados -- usá 💾 Guardar en cualquier escena generada." }));
                } else {
                    const grid = el("div", { className: "sg-grid" });
                    S.saved.forEach((sc, idx) => grid.appendChild(renderCard(sc, { savedView: true, idx })));
                    root.appendChild(grid);
                }
            }
        }

        renderView();
        loadSaved();
    },
    onOutput() {},
    onDone() {},
});
