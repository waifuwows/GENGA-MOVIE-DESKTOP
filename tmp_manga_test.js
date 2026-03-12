const consumet = require('./node_modules/@consumet/extensions');
const mangapill = new consumet.MANGA.Mangapill();

async function test() {
    try {
        const id = process.argv[2] || 'mangapill-manga-123';
        console.log(`Fetching info for: ${id}`);
        const info = await mangapill.fetchMangaInfo(id);
        console.log('Keys:', Object.keys(info));
        if (info.chapters) {
            console.log(`Found ${info.chapters.length} chapters`);
            console.log('First chapter sample:', info.chapters[0]);
        } else {
            console.log('No chapters field found');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
