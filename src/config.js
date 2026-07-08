// ═══════════════════════════════════════
//  CONFIG — CONSTANTES GLOBAIS
// ═══════════════════════════════════════

export const COLABORADORES_BASE = [
  {n:1,nome:'Carla Susana Francisco Duarte Alexandre Coelho',func:'Técn. Administrativo',ativo:false},{n:2,nome:'Sérgio Catita Fernandes',func:'Administrador',ativo:true},
  {n:3,nome:'Leopoldo Augusto Neves Martins',func:'Encarregado',ativo:true},{n:4,nome:'Artur Jorge Neves Martins',func:'Encarregado',ativo:true},
  {n:5,nome:'Manuel António Rodrigues Fonseca',func:'Responsável Dep. Comercial',ativo:true},{n:6,nome:'Orlando Fortes da Cruz',func:'Encarregado',ativo:true},
  {n:7,nome:'Luis Carlos dos Santos Vitor',func:'Encarregado',ativo:true},{n:8,nome:'Carlos Filipe Chamorrinha Mira dos Reis',func:'Diretor de Obra',ativo:true},
  {n:9,nome:'José Miguel Jardim Araújo',func:'Responsável Depto. Compras',ativo:true},{n:10,nome:'Carlos Mário Rodrigues Prata Pinto',func:'Encarregado',ativo:false},
  {n:11,nome:'Jesus Ricardo Fernandes Rosário',func:'Encarregado',ativo:true},{n:12,nome:'Athus Lucena Antunes',func:'Diretor de Obra Júnior',ativo:false},
  {n:13,nome:'David de Carvalho Mosca',func:'Diretor de Obra',ativo:true},{n:14,nome:'Fernando Lopes Costa',func:'Condutor Manobrador',ativo:true},
  {n:15,nome:'João Manuel da Silva Coelho',func:'Encarregado',ativo:true},{n:16,nome:'Ruben Filipe Caeiro de Sousa',func:'Motorista',ativo:false},
  {n:17,nome:'Eidy Ambrósio Lopes Ramos',func:'Condutor Manobrador',ativo:true},{n:18,nome:'Patrícia Alexandra Cabral Reis',func:'Técn. Administrativo',ativo:false},
  {n:19,nome:'Paulo Daniel Costa',func:'Condutor Manobrador',ativo:false},{n:20,nome:'Valdemir Luiz Ferreira',func:'Pedreiro',ativo:true},
  {n:21,nome:'Mykhaylo Putsil',func:'Pedreiro',ativo:true},{n:22,nome:'Manuel Catita Fernandes',func:'Assessor Financeiro',ativo:false},
  {n:23,nome:'Luiz Rogério Santos da Silva',func:'Pedreiro',ativo:false},{n:24,nome:'Robert Faria Martins',func:'Condutor Manobrador',ativo:false},
  {n:25,nome:'Vasyl Dychko',func:'Condutor Manobrador',ativo:true},{n:26,nome:'Hugo Manuel Vitor Luis',func:'Encarregado',ativo:true},
  {n:27,nome:'Vando Filipe Simões Daniel',func:'Assistente Dep Comercial',ativo:true},{n:28,nome:'Sebastião Luis Ferreira',func:'Servente',ativo:true},
  {n:29,nome:'Emanuel da Silva',func:'Servente',ativo:false},{n:30,nome:'Bubacar Seidi',func:'Servente',ativo:false},
  {n:31,nome:'Rui Paulo Saraiva Martins',func:'Condutor Manobrador',ativo:false},{n:32,nome:'Norberto Pinto da Silva',func:'Condutor Manobrador',ativo:false},
  {n:33,nome:'Emanuel Carlos Lopes Pedro',func:'Técn. Administrativo',ativo:true},{n:34,nome:'Rui Pedro dos Santos Alves',func:'Administraivo de Obra',ativo:true},
  {n:35,nome:'Tiago Manuel Norte Costa',func:'Servente',ativo:true},{n:36,nome:'Ivan Kylyvnyk',func:'Canalizador',ativo:false},
  {n:37,nome:'Inocêncio de Jesus Correia José',func:'Condutor Manobrador',ativo:true},{n:38,nome:'Elvis Lopes Ramos',func:'Condutor Manobrador',ativo:true},
  {n:39,nome:'Ronei de Jesus Ferreira Pedroua',func:'Encarregado',ativo:true},{n:40,nome:'Sukhprreet Singh Kooner',func:'Servente',ativo:true},
  {n:41,nome:'Ilisio Semedo Tavares',func:'Condutor Manobrador',ativo:false},{n:42,nome:'José Manuel Raimão da Silva Rodrigues',func:'Condutor Manobrador',ativo:true},
  {n:43,nome:'Pedro Miguel da Silva Santos',func:'Técn. Administrativo',ativo:false},{n:44,nome:'Domingos Manuel Fortes da Cruz',func:'Servente',ativo:true},
  {n:45,nome:'Elves Elias Gonçalves da Fonseca',func:'Pedreiro',ativo:true},{n:46,nome:'Luís da Costa Duarte São Pedro Martins',func:'Servente',ativo:false},
  {n:47,nome:'Manuel Joaquim Caixeiro da Silva',func:'Condutor Manobrador',ativo:false},{n:48,nome:'Adélia Ribeiro da Mota',func:'Téc. Sup.Seg. e Saúde no Trabalho',ativo:true},
  {n:49,nome:'Armindo Lobo Charrua',func:'Encarregado',ativo:true},{n:50,nome:'Diogo Manuel Santos José',func:'Motorista',ativo:true},
  {n:51,nome:'Bruno Miguel Sanches Pereira',func:'Servente',ativo:true},{n:52,nome:'David Luís Novo Gonçalves',func:'Encarregado',ativo:true},
  {n:53,nome:'Ashutosh Kainth',func:'Pedreiro',ativo:false},{n:54,nome:'Sundeep Kumar',func:'Pedreiro',ativo:true},
  {n:55,nome:'Lal Ji',func:'Servente',ativo:true},{n:56,nome:'Sukhvir Singh',func:'Servente',ativo:true},
  {n:57,nome:'Onkar Chand',func:'Canalizador',ativo:true},{n:58,nome:'Leandro Jorge Alexandre Pires',func:'Condutor Manobrador',ativo:true},
  {n:59,nome:'Carolina Ventura Roque',func:'Assistente DF & RH',ativo:false},{n:60,nome:'Joaquim Luis Dias Pereira',func:'Condutor Manobrador',ativo:true},
  {n:61,nome:'Valdemar Sílvio Rebelo',func:'Encarregado',ativo:true},{n:62,nome:'Domingos Semedo da Silva',func:'Servente',ativo:true},
  {n:63,nome:'José António dos Reis de Carvalho',func:'Pedreiro',ativo:true},{n:64,nome:'Nuno Miguel do Monte Farinho',func:'Motorista',ativo:false},
  {n:65,nome:'Edilson Lisboa Jorge',func:'Encarregado',ativo:true},{n:66,nome:'Said Ait Moussa',func:'Motorista',ativo:false},
  {n:67,nome:'Alejandro Reis Alves',func:'Administraivo de Obra',ativo:true},{n:68,nome:'Manuel Silva Mendonça',func:'Servente',ativo:true},
  {n:69,nome:'Douglas Cardoso Costa',func:'Condutor Manobrador',ativo:false},{n:70,nome:'Eduardo Manuel Pinheiro Miguel',func:'Condutor Manobrador',ativo:false},
  {n:71,nome:'Peter Luiz de Lima',func:'Canalizador',ativo:false},{n:72,nome:'António Augusto dos Santos Morgado',func:'Condutor Manobrador',ativo:true},
  {n:73,nome:'Vítor Hugo José Arraes',func:'Condutor Manobrador',ativo:true},{n:74,nome:'Pablo Juan Almeida Rocha',func:'Condutor Manobrador',ativo:true},
  {n:75,nome:'Rui Miguel Pereira Gonçalves',func:'Assistente Logistica',ativo:true},{n:76,nome:'Dimas Tavares Moreira',func:'Motorista',ativo:true},
  {n:77,nome:'Mamadu Uri Serra',func:'Condutor Manobrador',ativo:true},{n:78,nome:'Horácio Borges Freitas',func:'Condutor Manobrador',ativo:true},
  {n:79,nome:'Lucas Mendes Lopes',func:'Pedreiro',ativo:true},{n:80,nome:'Baldeep Singh',func:'Servente',ativo:true},
  {n:81,nome:'Harinder Singh',func:'Servente',ativo:true},{n:82,nome:'Kulwinder Pal',func:'Ajudante Canalizador',ativo:true},
  {n:83,nome:'Manpreet',func:'Servente',ativo:true},{n:84,nome:'Sajan Kumar',func:'Ajudante Canalizador',ativo:true},
  {n:85,nome:'Silvia Cristina Freitas Saraiva Ramos',func:'Técn. Administrativo',ativo:true},{n:86,nome:'Helton Neque Tavares Moreira Rodrigues',func:'Servente',ativo:true},
  {n:87,nome:'Bruno Emanuel Lopes Ramos',func:'Assistente Logistica',ativo:true},{n:88,nome:'Wilson Alex Moreno',func:'Servente',ativo:true},
  {n:89,nome:'Rachid Lachhab',func:'Motorista',ativo:true},{n:90,nome:'Edilson Teixeira de Oliveira',func:'Motorista',ativo:true},
];

export const USERS_BASE = {
  'admin':{pass:'Pd-9k2VmXq7Rz',nome:'Administrador',initials:'AD',role:'admin'},
};

export const ROLE_LABELS = {
  'admin':       'Administrador',
  'diretor_obra':'Diretor de Obra',
  'compras':     'Compras',
  'financeiro':  'Financeiro',
  'encarregado': 'Encarregado'
};

export const ROLE_ACCESS = {
  'admin':        {chapters:['rh','cmp','fin','log','prod','def'], default:'painel'},
  'diretor_obra': {chapters:['rh','cmp','fin','log','prod'],       default:'painel'},
  'compras':      {chapters:['cmp'],                               default:'painel'},
  'financeiro':   {chapters:['fin','cmp'],                         default:'painel'},
};

// Secções que emitem notificações (chave → rótulo legível).
// A chave 'seccao' usada em emitEvent deve corresponder ao destino de navegação (goTo).
export const NOTIF_SECTIONS = {
  'historico':    'Folha de Ponto',
  'compras':      'Compras',
  'faturas':      'Faturas',
  'equipamentos': 'Equipamentos',
  'combustivel':  'Combustível',
  'producao':     'Produção',
  'obras':        'Obras',
  'colaboradores':'Colaboradores',
  'utilizadores': 'Utilizadores',
  'mapa-ferias':  'Férias',
};

// Capítulos da sidebar — fonte única de verdade para o agrupamento de secções
// e para a matriz de "Permissões de Acesso" em Gerir Utilizadores.
export const NAV_CHAPTERS = [
  {id:'rh',   label:'Recursos Humanos',          sections:['historico','fecho-mes','mapa-ferias','colaboradores']},
  {id:'cmp',  label:'Compras',                   sections:['compras','mapas-comparativos']},
  {id:'fin',  label:'Financeiro',                sections:['faturas']},
  {id:'log',  label:'Logística e Equipamentos',  sections:['equipamentos','combustivel']},
  {id:'prod', label:'Produção',                  sections:['producao','precos-unitarios']},
  {id:'def',  label:'Definições',                sections:['obras','utilizadores','empresas-moa','fornecedores']},
];

export const TIPOS = ['Presença','Falta Injust.','Falta Just.','Férias'];
export const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const DIAS_PT_EXP = ['Segunda-Feira','Terça-Feira','Quarta-Feira','Quinta-Feira','Sexta-Feira','Sábado','Domingo'];
