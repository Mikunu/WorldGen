// Properties and scores are procedural design parameters, not calibrated measurements.
export const rocks=[
  {id:0,name:'Базальт',group:'Магматическая',color:'#65777a',resistance:0.85,permeability:0.25,nutrients:0.8},
  {id:1,name:'Гранит',group:'Магматическая',color:'#c29888',resistance:0.9,permeability:0.15,nutrients:0.35},
  {id:2,name:'Гнейс',group:'Метаморфическая',color:'#968da0',resistance:0.9,permeability:0.12,nutrients:0.4},
  {id:3,name:'Сланец метаморфический',group:'Метаморфическая',color:'#8b8e72',resistance:0.65,permeability:0.18,nutrients:0.45},
  {id:4,name:'Песчаник',group:'Осадочная',color:'#d2b87e',resistance:0.55,permeability:0.8,nutrients:0.35},
  {id:5,name:'Глинистый сланец',group:'Осадочная',color:'#a09a81',resistance:0.3,permeability:0.08,nutrients:0.6},
  {id:6,name:'Известняк',group:'Осадочная',color:'#d5d1aa',resistance:0.55,permeability:0.65,nutrients:0.65},
  {id:7,name:'Речные наносы',group:'Рыхлые отложения',color:'#96aa78',resistance:0.1,permeability:0.65,nutrients:0.85},
  {id:8,name:'Эвапориты',group:'Осадочная',color:'#ddcdda',resistance:0.15,permeability:0.05,nutrients:0.05},
  {id:9,name:'Мрамор',group:'Метаморфическая',color:'#cbc1d2',resistance:0.75,permeability:0.3,nutrients:0.55},
  {id:10,name:'Андезит',group:'Магматическая',color:'#b37c66',resistance:0.8,permeability:0.25,nutrients:0.7},
  {id:11,name:'Морские илы',group:'Рыхлые отложения',color:'#829aaf',resistance:0.08,permeability:0.12,nutrients:0.55}
];
export const provinceTypes=[
  {id:0,name:'Океанический бассейн',color:'#345f75'},
  {id:1,name:'Океанический хребет',color:'#5b9397'},
  {id:2,name:'Стабильная платформа',color:'#b3a385'},
  {id:3,name:'Складчатый пояс',color:'#ae8377'},
  {id:4,name:'Магматическая область',color:'#b2684d'},
  {id:5,name:'Рифтовая область',color:'#bda461'},
  {id:6,name:'Осадочный бассейн',color:'#a7af85'},
  {id:7,name:'Аллювиальная равнина',color:'#7f9f80'},
  {id:8,name:'Континентальный шельф',color:'#8cbbc3'}
];
export const minerals=[
  {name:'Медь',symbol:'Cu',color:'#e0a06b',unit:'% Cu',oreMinerals:'Халькопирит, борнит, халькозин',group:'Цветные металлы'},
  {name:'Золото',symbol:'Au',color:'#e8cd72',unit:'г/т Au',oreMinerals:'Самородное золото, электрум',group:'Благородные металлы'},
  {name:'Олово',symbol:'Sn',color:'#c5dbdd',unit:'% Sn',oreMinerals:'Касситерит',group:'Редкие металлы'},
  {name:'Железо',symbol:'Fe',color:'#c47f6d',unit:'% Fe',oreMinerals:'Гематит, магнетит',group:'Чёрные и легирующие металлы'},
  {name:'Уголь',symbol:'C',color:'#7d8287',unit:'% угля',oreMinerals:'Угольный пласт; органическое сырьё',group:'Топливо'},
  {name:'Каменная соль',symbol:'NaCl',color:'#e0d9f0',unit:'% NaCl',oreMinerals:'Галит',group:'Нерудное сырьё'},
  {name:'Свинец',symbol:'Pb',color:'#a4aabf',unit:'% Pb',oreMinerals:'Галенит',group:'Цветные металлы'},
  {name:'Цинк',symbol:'Zn',color:'#a6bac5',unit:'% Zn',oreMinerals:'Сфалерит',group:'Цветные металлы'},
  {name:'Серебро',symbol:'Ag',color:'#e1e5e6',unit:'г/т Ag',oreMinerals:'Акантит, серебросодержащий галенит',group:'Благородные металлы'},
  {name:'Никель',symbol:'Ni',color:'#91b798',unit:'% Ni',oreMinerals:'Пентландит; никеленосные силикатные и оксидные минералы',group:'Цветные металлы'},
  {name:'Кобальт',symbol:'Co',color:'#8d9fc5',unit:'% Co',oreMinerals:'Кобальтсодержащие сульфиды и оксиды',group:'Цветные металлы'},
  {name:'Марганец',symbol:'Mn',color:'#aa869a',unit:'% Mn',oreMinerals:'Пиролюзит, родохрозит',group:'Чёрные и легирующие металлы'},
  {name:'Хром',symbol:'Cr',color:'#7b9b80',unit:'% Cr₂O₃',oreMinerals:'Хромит',group:'Чёрные и легирующие металлы'},
  {name:'Титан',symbol:'Ti',color:'#b5a591',unit:'% TiO₂',oreMinerals:'Ильменит, рутил',group:'Чёрные и легирующие металлы'},
  {name:'Молибден',symbol:'Mo',color:'#a5a4c3',unit:'% Mo',oreMinerals:'Молибденит',group:'Чёрные и легирующие металлы'},
  {name:'Вольфрам',symbol:'W',color:'#b5c2b4',unit:'% WO₃',oreMinerals:'Шеелит, вольфрамит',group:'Чёрные и легирующие металлы'},
  {name:'Бокситы',symbol:'Al',color:'#ce9975',unit:'% Al₂O₃',oreMinerals:'Гиббсит, бёмит, диаспор',group:'Цветные металлы'},
  {name:'Уран',symbol:'U',color:'#bac581',unit:'% U',oreMinerals:'Уранинит, коффинит',group:'Энергетическое сырьё'},
  {name:'Литий',symbol:'Li',color:'#d5aebf',unit:'% Li₂O',oreMinerals:'Сподумен, петалит, лепидолит',group:'Редкие металлы'},
  {name:'Редкоземельные элементы',symbol:'REE',color:'#bdb18b',unit:'% REO',oreMinerals:'Бастнезит, монацит',group:'Редкие металлы'},
  {name:'Металлы платиновой группы',symbol:'PGE',color:'#e3d8bd',unit:'г/т PGE',oreMinerals:'Сперрилит и другие минералы платиновой группы',group:'Благородные металлы'},
  {name:'Ртуть',symbol:'Hg',color:'#c97e78',unit:'% Hg',oreMinerals:'Киноварь',group:'Цветные металлы'},
  {name:'Сурьма',symbol:'Sb',color:'#bfa5ac',unit:'% Sb',oreMinerals:'Антимонит',group:'Редкие металлы'},
  {name:'Ниобий',symbol:'Nb',color:'#aa9ec3',unit:'% Nb₂O₅',oreMinerals:'Пирохлор, колумбит',group:'Редкие металлы'},
  {name:'Тантал',symbol:'Ta',color:'#aab5c4',unit:'% Ta₂O₅',oreMinerals:'Танталит, колумбит-танталит',group:'Редкие металлы'},
  {name:'Ванадий',symbol:'V',color:'#94a5b1',unit:'% V₂O₅',oreMinerals:'Ванадийсодержащий титаномагнетит',group:'Чёрные и легирующие металлы'},
  {name:'Фосфатное сырьё',symbol:'P',color:'#b6c594',unit:'% P₂O₅',oreMinerals:'Апатит, фосфориты',group:'Нерудное сырьё'},
  {name:'Калийные соли',symbol:'K',color:'#d1a7a2',unit:'% K₂O',oreMinerals:'Сильвин, карналлит',group:'Нерудное сырьё'},
  {name:'Гипс',symbol:'Gyp',color:'#e0ddc8',unit:'% CaSO₄·2H₂O',oreMinerals:'Гипс',group:'Нерудное сырьё'},
  {name:'Графит',symbol:'Gr',color:'#858f91',unit:'% графитового C',oreMinerals:'Графит',group:'Нерудное сырьё'},
  {name:'Флюорит',symbol:'F',color:'#b6a4c4',unit:'% CaF₂',oreMinerals:'Флюорит',group:'Нерудное сырьё'},
  {name:'Барит',symbol:'Ba',color:'#d2c2a1',unit:'% BaSO₄',oreMinerals:'Барит',group:'Нерудное сырьё'}
].map((m,id)=>({...m,id,gradeDenominator:m.unit.startsWith('г/т')?1e6:100,resourceBasis:m.unit.replace(/^(%|г\/т) /,'')}));
export const hazardTypes=[
  {id:'earthquake',name:'Сейсмичность'},
  {id:'volcanic',name:'Вулканизм'},
  {id:'landslide',name:'Оползни'},
  {id:'flood',name:'Паводки'},
  {id:'karst',name:'Карст'}
];
