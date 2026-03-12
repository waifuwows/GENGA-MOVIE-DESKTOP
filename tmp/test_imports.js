const { ANIME, MANA, NEWS } = require('@consumet/extensions');
const { HiAnime } = require('@genga-movie/aniwatch');

console.log('ANIME keys:', Object.keys(ANIME || {}));
console.log('MANA exists:', !!MANA);
console.log('NEWS keys:', Object.keys(NEWS || {}));

const h = new HiAnime();
console.log('HiAnime methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(h)));
