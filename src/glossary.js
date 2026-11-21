export const acronyms = Object.freeze({
  AP: 'Advanced Placement', ATP: 'adenosine triphosphate', FAFSA: 'Free Application for Federal Student Aid',
  GPA: 'grade point average', HTML: 'Hypertext Markup Language', ID: 'identification', PDF: 'Portable Document Format',
  RSVP: 'please reply', SAI: 'Student Aid Index', STEM: 'science, technology, engineering and mathematics',
  USD: 'US dollars', WCAG: 'Web Content Accessibility Guidelines',
  'U.S.': 'United States', 'U.K.': 'United Kingdom', 'U.N.': 'United Nations', 'D.C.': 'District of Columbia'
});

export const jargon = Object.freeze({
  aliquot: 'measured portion', ascertain: 'find out', commence: 'start', concatenate: 'join',
  contemporaneously: 'at the same time', disseminate: 'share', electrophoresis: 'separation using an electric field',
  endothermic: 'taking in heat', facilitate: 'help', fluorescence: 'light emitted after absorbing light',
  matriculation: 'enrollment', methodology: 'method', mitigation: 'reducing harm', osmosis: 'movement of water across a membrane',
  phosphorylation: 'addition of a phosphate group', prerequisite: 'requirement', reimbursement: 'repayment',
  semipermeable: 'letting some substances pass', subsequently: 'later', utilization: 'use', utilize: 'use'
});

// A deliberately small, frozen classroom vocabulary, not the published Dale-Chall list.
export const common = new Set(`
  a about above across action add after again all also am an and any are as at away back be because been before
  begin below between big both but by call can change check class clean close come could day did do does done down
  during each easy end enough even every example far fast few file find first follow for form from full get give go
  good great group had hand has have he help her here high him his how i if in into is it its keep key kind know
  lab last later learn leave left less let level life light like line list little live long look low made make may
  me might more most move much must my name near need new next night no not now of off often on once one only open
  or other our out over page part pass past people place plan play point put read real right room same school see
  send set she show side sign small so some start state step still stop study such take tell test than that the their
  them then there these they thing this those through time to too top try turn two under up us use very want was
  water way we well were what when where which while who why will with word work would write year yes you your
`.trim().split(/\s+/));
