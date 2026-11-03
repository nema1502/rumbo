% La clase de los documentos de Rumbo que se imprimen: el informe del evento y el certificado de
% asistencia. La marca está en docs/marca.md: papel, tinta y naranja; Bricolage Grotesque para los
% títulos y los números grandes, Inter para el texto. Compila con XeLaTeX (fontspec).
%
% Los datos llegan en datos.tex, que escribe el generador (scripts/informe.mjs o
% scripts/certificados.mjs): cada valor con \rumboset{clave}{valor}, ya escapado, y cada enlace con
% \rumbourl{clave}|enlace|. La plantilla los lee con \V{clave} y \U{clave}, y pregunta si existen con
% \rumboif{clave}{si}{no}.
%
% Opciones: "certificado" (A4 apaisado, sin cabecera ni pie: el certificado se dibuja entero).
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{rumbo-informe}[2026/11/03 Rumbo, documentos para imprimir]

\newif\ifrumbo@certificado
\DeclareOption{certificado}{\rumbo@certificadotrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessOptions\relax
% Las fuentes de matemática de base, escalables: si no, cada tamaño nuevo avisa que le falta una.
\RequirePackage{fix-cm}
\LoadClass[10pt]{article}

\RequirePackage{iftex}
\RequireXeTeX

\ifrumbo@certificado
  \RequirePackage[a4paper,landscape,margin=0mm]{geometry}
\else
  \RequirePackage[a4paper,top=31mm,bottom=27mm,left=22mm,right=22mm,headheight=0mm,headsep=0mm,footskip=0mm]{geometry}
\fi

\RequirePackage[english,spanish,es-minimal]{babel}
\RequirePackage{fontspec}
\RequirePackage{xcolor}
\RequirePackage{graphicx}
\RequirePackage{tikz}
\usetikzlibrary{calc}
\RequirePackage{tcolorbox}
\tcbuselibrary{skins,raster}
\RequirePackage{array}
\RequirePackage{tabularx}
\RequirePackage{booktabs}
\RequirePackage{needspace}
\RequirePackage{etoolbox}
\RequirePackage{lastpage}
\RequirePackage{microtype}
\RequirePackage[hidelinks]{hyperref}
\urlstyle{same}

% ---------- Los colores (docs/marca.md, tema día) ----------

\definecolor{papel}{HTML}{F7F2E8}
\definecolor{tarjeta}{HTML}{FFFFFF}
\definecolor{tinta}{HTML}{0F1C2E}
\definecolor{tinta2}{HTML}{3D4B5F}
\definecolor{apagado}{HTML}{5B6675}
\definecolor{naranja}{HTML}{E8541E}
\definecolor{naranjaTexto}{HTML}{C2410C}
\definecolor{naranjaChip}{HTML}{B43A0A}
\definecolor{verde}{HTML}{0B7A68}
\definecolor{verdeChip}{HTML}{0A7060}
\definecolor{amarillo}{HTML}{F5C451}
% Sobre el bloque de tinta: el texto secundario del tema noche.
\definecolor{crema}{HTML}{F4EFE6}
\definecolor{crema2}{HTML}{C9C2B5}
% La línea fina y los fondos suaves: el mismo color al 12 por ciento, sobre blanco.
\colorlet{linea}{tinta!12!tarjeta}
\colorlet{lineaPapel}{tinta!12!papel}
\colorlet{naranjaSuave}{naranja!12!tarjeta}
\colorlet{verdeSuave}{verde!12!tarjeta}
\colorlet{amarilloSuave}{amarillo!35!tarjeta}
% Las barras de contexto (inscritos) en un gris de tinta que no compite con lo que entró.
\colorlet{barraContexto}{tinta!22!tarjeta}

\pagecolor{papel}
\color{tinta}

% ---------- Las fuentes (app/informes/fuentes, con sus licencias OFL) ----------
% Inter trae regular y seminegrita. No hay cursiva: si algo la pide, sale inclinada a mano.

\defaultfontfeatures{Ligatures=TeX}
\setmainfont{Inter}[
  Path=fuentes/, Extension=.ttf,
  UprightFont=*-Regular, BoldFont=*-SemiBold,
  ItalicFont=*-Regular, ItalicFeatures={FakeSlant=0.16},
  BoldItalicFont=*-SemiBold, BoldItalicFeatures={FakeSlant=0.16}]
\setsansfont{Inter}[
  Path=fuentes/, Extension=.ttf,
  UprightFont=*-Regular, BoldFont=*-SemiBold,
  ItalicFont=*-Regular, ItalicFeatures={FakeSlant=0.16},
  BoldItalicFont=*-SemiBold, BoldItalicFeatures={FakeSlant=0.16}]
% Los números que se alinean en columna (tablas, ejes): de ancho fijo.
\newfontfamily\rumboTabular{Inter}[
  Path=fuentes/, Extension=.ttf, Numbers=Monospaced,
  UprightFont=*-Regular, BoldFont=*-SemiBold,
  ItalicFont=*-Regular, ItalicFeatures={FakeSlant=0.16},
  BoldItalicFont=*-SemiBold, BoldItalicFeatures={FakeSlant=0.16}]
% Los títulos: Bricolage Grotesque, con el interletrado un poco cerrado.
\newfontfamily\rumboTitulo{BricolageGrotesque96pt}[
  Path=fuentes/, Extension=.ttf, LetterSpace=-1.5,
  UprightFont=*-Bold, BoldFont=*-ExtraBold,
  ItalicFont=*-Bold, ItalicFeatures={FakeSlant=0.12},
  BoldItalicFont=*-ExtraBold, BoldItalicFeatures={FakeSlant=0.12}]
% Los números grandes y el nombre de la marca: el peso 800.
\newfontfamily\rumboCifra{BricolageGrotesque96pt}[
  Path=fuentes/, Extension=.ttf, LetterSpace=-2,
  UprightFont=*-ExtraBold, BoldFont=*-ExtraBold,
  ItalicFont=*-ExtraBold, ItalicFeatures={FakeSlant=0.12},
  BoldItalicFont=*-ExtraBold, BoldItalicFeatures={FakeSlant=0.12}]
% Los títulos chicos (la tipografía en su tamaño de texto).
\newfontfamily\rumboTituloChico{BricolageGrotesque}[
  Path=fuentes/, Extension=.ttf, LetterSpace=-1,
  UprightFont=*-Bold, BoldFont=*-Bold,
  ItalicFont=*-Bold, ItalicFeatures={FakeSlant=0.12},
  BoldItalicFont=*-Bold, BoldItalicFeatures={FakeSlant=0.12}]

\renewcommand\normalsize{\fontsize{10}{15}\selectfont}
\normalsize
\setlength\parindent{0pt}
\setlength\parskip{0pt}
\raggedright
\frenchspacing
\pagestyle{empty}
\setlength\emergencystretch{2em}
\hyphenpenalty=600
\tolerance=2000

% ---------- Los datos ----------

\newcommand\rumboset[2]{\expandafter\def\csname rumbo@v@#1\endcsname{#2}}
% Un valor. Si falta, el documento no compila: mejor un error que un informe con huecos.
\newcommand\V[1]{\ifcsname rumbo@v@#1\endcsname\csname rumbo@v@#1\endcsname\else\rumbo@falta{#1}\fi}
\newcommand\rumbo@falta[1]{\ClassError{rumbo-informe}{Falta el dato "#1" en datos.tex}{El generador tiene que escribirlo con rumboset.}}
\newcommand\rumboif[3]{\ifcsname rumbo@v@#1\endcsname#2\else#3\fi}
% Un enlace, leído tal cual: con #, %, &, ~ y _ como letras. Lo delimitan dos barras verticales.
\newcommand\rumbourl[1]{\begingroup\def\rumbo@ukey{#1}%
  \catcode`\#=12 \catcode`\%=12 \catcode`\&=12 \catcode`\~=12 \catcode`\_=12 \catcode`\$=12 \catcode`\^=12
  \rumbo@urlread}
\def\rumbo@urlread|#1|{\expandafter\xdef\csname rumbo@u@\rumbo@ukey\endcsname{#1}\endgroup}
\newcommand\U[1]{\ifcsname rumbo@u@#1\endcsname\csname rumbo@u@#1\endcsname\else\rumbo@falta{#1}\fi}
\newcommand\rumboEnlace[2]{\href{\U{#1}}{#2}}
% El idioma del documento (spanish o english), para los cortes de palabra.
\newcommand\rumboIdioma{\edef\rumbo@idioma{\V{babel}}\expandafter\selectlanguage\expandafter{\rumbo@idioma}}

% ---------- Las piezas ----------

\newlength\rumbo@ancho
\setlength\rumbo@ancho{\textwidth}

% El título de una sección: una raya naranja corta, el título y una bajada opcional.
\newcommand\rumboSeccion[2]{%
  \par\needspace{62mm}\vspace{10mm}%
  {\color{naranja}\rule{12mm}{1.6pt}}\par\vspace{3.2mm}%
  {\rumboTitulo\fontsize{21}{25}\selectfont\color{tinta}#1\par}%
  \ifblank{#2}{}{\vspace{2.4mm}{\fontsize{10.5}{15.5}\selectfont\color{tinta2}\parbox{148mm}{\raggedright#2}\par}}%
  \vspace{6mm}}

% Un subtítulo dentro de una sección.
\newcommand\rumboSubtitulo[1]{\par\needspace{30mm}\vspace{6mm}{\rumboTituloChico\fontsize{12.5}{16}\selectfont\color{tinta}#1\par}\vspace{2.6mm}}

% Un párrafo de texto corrido, con el ancho de lectura cómodo.
\newcommand\rumboParrafo[1]{\parbox{150mm}{\raggedright\fontsize{10}{15}\selectfont\color{tinta2}#1}\par}

% Una nota chica en el color apagado.
\newcommand\rumboNota[1]{{\fontsize{8.2}{12}\selectfont\color{apagado}#1\par}}

% La tarjeta blanca de la marca: borde fino y esquinas redondeadas.
% Sin transparencias en ningún lado: los colores suaves ya vienen mezclados con el fondo.
\tcbset{
  rumbo/.style={colback=tarjeta, colframe=linea, coltext=tinta, boxrule=0.5pt, arc=3.2mm,
    left=5mm, right=5mm, top=4.6mm, bottom=4.6mm, before skip=0pt, after skip=0pt,
    before upper={\raggedright\hyphenpenalty=600 }},
  rumboOscura/.style={colback=tinta, colframe=tinta, boxrule=0pt, arc=3.2mm,
    left=6mm, right=6mm, top=5.5mm, bottom=5.5mm, before skip=0pt, after skip=0pt, coltext=crema,
    before upper={\raggedright\hyphenpenalty=600 }},
  rumboAviso/.style={colback=amarilloSuave, colframe=amarillo, coltext=tinta, boxrule=0.6pt, arc=3.2mm,
    left=5mm, right=5mm, top=3.4mm, bottom=3.4mm, before skip=0pt, after skip=0pt,
    before upper={\raggedright\hyphenpenalty=600 }},
}
\newenvironment{rumboTarjeta}{\begin{tcolorbox}[rumbo]}{\end{tcolorbox}}

% Una cifra grande con su etiqueta y una línea de detalle, para ir dentro de una grilla.
\newcommand\rumboCifraTarjeta[3]{%
  \begin{tcolorbox}[rumbo, top=3.6mm, bottom=3.9mm]
    {\rumboCifra\fontsize{28}{29}\selectfont #1\par}\vspace{1.8mm}%
    {\fontsize{9.2}{12}\selectfont\bfseries\color{tinta}#2\par}%
    \ifblank{#3}{}{\vspace{0.9mm}{\fontsize{8}{11}\selectfont\color{apagado}#3\par}}%
  \end{tcolorbox}}
% Tres cifras por fila, todas del mismo alto.
\newenvironment{rumboCifras}[1][3]{\begin{tcbraster}[raster columns=#1, raster equal height=rows, raster column skip=4mm, raster row skip=4mm, raster before skip=0pt, raster after skip=0pt]}{\end{tcbraster}}

% Los chips de estado: siempre con palabra y color (listo en verde, pendiente en naranja, ganado en amarillo).
\newcommand\rumbo@chip[3]{\tikz[baseline=(c.base)]\node[fill=#1, text=#2, rounded corners=1.6mm, inner xsep=2.4mm, inner ysep=1.2mm, font=\fontsize{8}{9}\selectfont\bfseries](c){#3};}
\newcommand\rumboChipListo[1]{\rumbo@chip{verdeSuave}{verdeChip}{#1}}
\newcommand\rumboChipPendiente[1]{\rumbo@chip{naranjaSuave}{naranjaChip}{#1}}
\newcommand\rumboChipGanado[1]{\rumbo@chip{amarilloSuave}{tinta}{#1}}

% Un código público (el contrato, una transacción), con números de ancho fijo.
\newcommand\rumboCodigo[1]{\leavevmode{\rumboTabular\fontsize{8.4}{11}\selectfont\color{tinta}#1}}
% Un enlace a la vista: naranja oscuro, que es el naranja que se lee como texto.
\newcommand\rumboEnlaceVisible[2]{\leavevmode{\color{naranjaTexto}\href{\U{#1}}{#2}}}

% ---------- Las tablas ----------
% Sin rayado pesado: una línea fina arriba y abajo, y entre filas solo aire.

\newcolumntype{L}{>{\raggedright\arraybackslash}X}
\newcolumntype{N}[1]{>{\raggedleft\arraybackslash\rumboTabular}p{#1}}
\newcolumntype{T}[1]{>{\raggedright\arraybackslash}p{#1}}
\setlength\heavyrulewidth{0.5pt}
\setlength\lightrulewidth{0.4pt}
\setlength\aboverulesep{0pt}
\setlength\belowrulesep{0pt}
\setlength\tabcolsep{2.2mm}
% En una celda, el color va después de \leavevmode: si queda arriba de todo, la celda se cuelga hacia abajo.
\newcommand\rumboEncabezado[1]{\leavevmode{\fontsize{7.8}{10}\selectfont\bfseries\color{apagado}#1}}
% El color va en su propio grupo: si no, la vuelta al color de antes cae en la fila siguiente y
% un \multicolumn ya no puede ir primero.
\newcommand\rumboEntreFilas{\noalign{{\color{linea}\hrule height 0.4pt}}}
% La primera fila (el encabezado) sube un poco: el aire de arriba ya lo da la tarjeta.
\newcommand\rumboArriba{\noalign{\vskip-2.2mm}}
% Empieza su propio párrafo: al principio de una tarjeta, una tabla sin párrafo deja una línea vacía arriba.
\newenvironment{rumboTabla}[1]{%
  \leavevmode\renewcommand\arraystretch{1.75}\fontsize{9.4}{12}\selectfont%
  \tabularx{\linewidth}{@{}#1@{}}}{\endtabularx}

% ---------- Los gráficos ----------
% Barras finas, con el extremo de los datos redondeado, el valor al lado y sin grilla.

\newlength\rumboBarraMax
\setlength\rumboBarraMax{68mm}
% Una barra horizontal: etiqueta, valor ya escrito, fracción del máximo (0 a 1), color, nota.
\newcommand\rumboBarra[5]{%
  \par\noindent\begin{tikzpicture}[x=1mm, y=1mm, baseline=(base)]
    \coordinate (base) at (0,-1);
    \node[anchor=east, inner sep=0, text width=36mm, align=right, font=\fontsize{9}{11}\selectfont\color{tinta}] at (36,0) {#1};
    \pgfmathsetmacro\rumbo@w{max(#3*\the\rumboBarraMax/1mm, 0.8)}
    \fill[#4] (40,-2.3) -- (40,2.3) -- ({40+\rumbo@w-0.9},2.3) arc[start angle=90, end angle=0, radius=0.9] -- ({40+\rumbo@w},-1.4) arc[start angle=0, end angle=-90, radius=0.9] -- cycle;
    \node[anchor=west, inner sep=0, font=\rumboTabular\fontsize{9.4}{11}\selectfont\bfseries\color{tinta}] (v) at ({40+\rumbo@w+2.4},0) {#2};
    \ifblank{#5}{}{\node[anchor=west, inner sep=0, font=\fontsize{7.8}{10}\selectfont\color{apagado}] at ($(v.east)+(2.2,0)$) {#5};}
  \end{tikzpicture}\par\vspace{1.9mm}}

% Las columnas de la llegada por hora. \rumboColumna{posición}{hora}{valor}{fracción} va dentro de
% \rumboColumnas{cantidad}{columnas}.
\newcommand\rumboColumnas[2]{%
  \par\noindent\begin{tikzpicture}[x=1mm, y=1mm]
    \pgfmathsetmacro\rumbo@paso{150/#1}
    \pgfmathsetmacro\rumbo@ancho{min(\rumbo@paso*0.62, 11)}
    \def\rumboColumna##1##2##3##4{%
      \pgfmathsetmacro\rumbo@x{(##1+0.5)*\rumbo@paso}
      \pgfmathsetmacro\rumbo@h{max(##4*30, 0.6)}
      \fill[naranja] ({\rumbo@x-\rumbo@ancho/2},0) -- ({\rumbo@x-\rumbo@ancho/2},{\rumbo@h-0.9}) arc[start angle=180, end angle=90, radius=0.9] -- ({\rumbo@x+\rumbo@ancho/2-0.9},\rumbo@h) arc[start angle=90, end angle=0, radius=0.9] -- ({\rumbo@x+\rumbo@ancho/2},0) -- cycle;
      \node[anchor=south, inner sep=0, font=\rumboTabular\fontsize{8.6}{10}\selectfont\bfseries\color{tinta}] at (\rumbo@x,{\rumbo@h+1.6}) {##3};
      \node[anchor=north, inner sep=0, font=\rumboTabular\fontsize{7.6}{9}\selectfont\color{apagado}] at (\rumbo@x,-2.2) {##2};
    }
    #2
    \draw[line width=0.4pt, color=linea] (0,0) -- (150,0);
  \end{tikzpicture}\par}

% Una barra de medida con un tope marcado (la comida por persona frente a los 25 dólares).
% \rumboMedida{fracción del valor}{fracción del tope}{color}{texto del tope}
\newcommand\rumboMedida[4]{%
  \par\noindent\begin{tikzpicture}[x=1mm, y=1mm]
    \fill[linea] (0,-1.6) rectangle (150,1.6);
    \pgfmathsetmacro\rumbo@w{max(min(#1,1)*150, 0.8)}
    \fill[#3] (0,-1.6) -- (0,1.6) -- ({\rumbo@w-0.8},1.6) arc[start angle=90, end angle=0, radius=0.8] -- (\rumbo@w,-0.8) arc[start angle=0, end angle=-90, radius=0.8] -- cycle;
    \pgfmathsetmacro\rumbo@t{#2*150}
    \draw[line width=1.2pt, color=tinta] (\rumbo@t,-3.6) -- (\rumbo@t,3.6);
    \node[anchor=south, inner sep=0, font=\fontsize{7.8}{10}\selectfont\bfseries\color{tinta}] at (\rumbo@t,4.8) {#4};
  \end{tikzpicture}\par}

% ---------- La brújula ----------
% El símbolo de la marca dibujado como site/assets/logo.svg: el anillo, la aguja girada 35 grados con
% la punta naranja, y el punto del centro. \rumboBrujula{radio en mm}{color del anillo}{color de la
% cola}{color del punto}. En el logo, el anillo va al 50 por ciento y la cola al 85: acá esos colores
% ya vienen mezclados con el fondo.
\newcommand\rumboBrujula[4]{%
  \begin{scope}[x=#1mm/29, y=#1mm/29]
    \draw[color=#2, line width=0.075*#1pt] (0,0) circle[radius=29];
    \begin{scope}[rotate=-35]
      \fill[naranja] (0,28) -- (9,0) -- (0,4) -- (-9,0) -- cycle;
      \fill[#3] (0,-28) -- (-9,0) -- (0,-4) -- (9,0) -- cycle;
    \end{scope}
    \fill[#4] (0,0) circle[radius=4];
  \end{scope}}

% ---------- La página: el aviso de ejemplo, la cabecera y el pie ----------
% Se dibujan en el fondo de cada página (shipout/background): el origen es la esquina de arriba a la
% izquierda y la y crece hacia abajo con signo menos.

\newcommand\rumbo@avisoEjemplo{%
  \rumboif{ejemplo}{%
    \fill[amarillo] (0,0) rectangle (\rumbo@pw,-8);
    \node[inner sep=0, font=\fontsize{8.4}{10}\selectfont\bfseries\color{tinta}] at (\rumbo@pw/2,-4.1) {\V{t.ejemplo.franja}};
  }{}}

\newcommand\rumbo@cabeceraYPie{%
  \node[anchor=west, inner sep=0] at (22,-19.5) {\includegraphics[height=5.6mm]{marca/logo-tinta.pdf}};
  \node[anchor=west, inner sep=0, font=\rumboCifra\fontsize{12.5}{13}\selectfont\color{tinta}] at (29.3,-19.5) {Rumbo};
  \node[anchor=east, inner sep=0, text width=110mm, align=right, font=\fontsize{8}{10}\selectfont\color{apagado}] at (188,-19.5) {\V{t.cabecera}};
  \draw[line width=0.4pt, color=lineaPapel] (22,-280.5) -- (188,-280.5);
  \node[anchor=west, inner sep=0, font=\fontsize{7.8}{10}\selectfont\color{apagado}] at (22,-285.5) {\V{t.pie}};
  \node[anchor=east, inner sep=0, font=\rumboTabular\fontsize{7.8}{10}\selectfont\color{apagado}] at (188,-285.5) {\V{t.pagina.antes}\thepage\V{t.pagina.de}\pageref*{LastPage}};
}

\def\rumbo@pw{210}
\ifrumbo@certificado\def\rumbo@pw{297}\fi

\AddToHook{shipout/background}{%
  \put(0,0){\begin{tikzpicture}[overlay, x=1mm, y=1mm]
    \ifrumbo@certificado
      \rumboCertificadoFondo
    \else
      \ifnum\c@page=1 \rumboPortadaFondo\else\rumbo@cabeceraYPie\fi
    \fi
    \rumbo@avisoEjemplo
  \end{tikzpicture}}}

% La plantilla define lo que va en el fondo de la portada y del certificado.
\providecommand\rumboPortadaFondo{}
\providecommand\rumboCertificadoFondo{}

\endinput
