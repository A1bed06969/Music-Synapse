// scripts/import-nme-100.ts
//
// NME誌の年次企画「The NME 100」(世界中の注目すべき新鋭アーティスト100組、
// 2017年開始)を、キュレーションコンテンツ(ranking/ranking_entry)として
// 一括登録する。データは各年のnme.com公式記事から取得(2024年は複数回
// 検索しても該当記事が見つからず、NME側の欠年と判断して対象から除外)。
// 2025・2026年はユーザー提供のスプレッドシートと突き合わせ済み。
//
// scripts/import-radar-early-noise.tsと同じ「候補が1件だけ、かつ正規化後の
// 名前が完全一致」の場合のみ自動リンクする方針だが、RADAR実行時に発覚した
// 不具合(Apple Music検索を先に行うと、既に実データ登録済みの同名アーティストが
// いてもそれを見つけられず別行を作ってしまうケースがあった)を踏まえ、
// 検索より先に「既に実データ登録済みの同名アーティスト」を確認するステップを
// 追加している。海外アーティストの英語名主体のリストのため、RADARで問題になった
// ローマ字化によるズレ(日本語名で検索してもApple Music側はローマ字名で返す)は
// 基本的に発生しない想定。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/import-nme-100.ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist } from '@/utils/itunes'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'

const RANKING_NAME = 'The NME 100'

const ROSTER: Record<string, string[]> = {
  '2017': [
    'AJ Tracey', 'Cabbage', 'Declan McKenna', 'The Japanese House', 'Bonzai', 'Artificial Pleasure', 'PWR BTTM',
    'The Big Moon', 'HMLTD', 'Hare Squead', 'Bad Nerves', 'Liv Dawson', 'Rejjie Snow', 'Dagny', 'Nadia Rose',
    'Stevie Parker', 'Alexandra Savior', 'Estrons', 'THEY.', 'Shame', 'Fickle Friends', 'Cosima', 'Creeper',
    'Nimmo', 'Dave', 'Catholic Action', 'Stefflon Don', 'The Amazons', 'Nova Twins', 'Her', 'Joe Fox',
    'Goat Girl', 'Sälen', 'Bad Sounds', 'Gaika', 'Little Cub', 'Jodie Abacus', 'Dua Lipa', 'Dessert',
    'Joey Purp', 'Lao Ra', 'Courts', 'Pixx', 'Yowl', 'QTY', 'Parri$', 'Sundara Karma', '6lack', 'Miya Folick',
    'Obongjayar', 'Tom Misch', 'Jay Prince', 'Will Joseph Cook', 'InHeaven', "Rag'N'Bone Man", 'Sløtface',
    'Hazel English', 'Georgie', 'A2', 'Maggie Rogers', 'Anne-Marie', 'Harlea', 'Dream Wife', 'Willow Robinson',
    'Aathens', 'King Nun', 'Tom Grennan', 'Holly Macve', 'Noga Erez', 'Alfa Mist', 'Young Yizzy', 'Tender',
    'Idles', 'The Manor', 'Kero Kero Bonito', 'Trudy And The Romance', 'Abra', 'Muna', 'Cigarettes After Sex',
    'Kehlani', 'Pasha', 'Jorja Smith', 'Connie Constance', 'Skott', 'Siba', 'Abattoir Blues',
    'She Drew The Gun', 'Ray BLK', 'Cherry Glazerr', 'Patience', '808INK', 'The Hour', 'SLO',
    'Hannah Lou Clark', 'Machineheart', 'Jagara', 'Tsar B',
  ],
  '2018': [
    'Yonaka', 'Gaffa Tape Sandy', 'Shady Nasty', 'The Pale White', 'RedFaces', 'Ecca Vandal', 'Starcrawler',
    'Drahla', 'Shame', 'Milk Disco', 'The Britanys', 'Thyla', 'Moaning', 'Dream Wife', 'Darcie', 'Sea Girls',
    'Tash Sultana', 'Mabel', 'Jorja Smith', 'Mahalia', 'Smerz', 'Dounia', 'Madison Beer', 'Sudan Archives',
    'Jessie Reyez', 'Kwaye', 'Caleb Kunle', 'Alaskalaska', 'Yellow Days', 'Mina Rose', 'Amber Mark',
    'Thunder Jackson', 'Rex Orange County', 'Gotts Street Park', 'Col3trane', 'IAMDDB', 'Mike', 'Dave',
    'Belly Squad', 'Tom Tripp', 'Hak Baker', 'Standing On The Corner', 'Kojo Funds', 'Rejjie Snow',
    'Layfullstop', 'Raye', 'Pale Waves', 'Mallrat', 'Matt Maltese', 'Superorganism', 'Yungblud', 'Arlie',
    'Brooke Bentham', 'Julia Michaels', 'Billie Eilish', 'Sigrid', 'Kali Uchis', 'Joan', 'Tove Styrke',
    'Tom Grennan', 'Rina Sawayama', 'Maggie Rogers', 'A House In The Trees', 'Whenyoung', 'Cosmo Pyke',
    'Phoebe Bridgers', 'Blushes', 'Mellah', 'Pom Poko', 'Dama Scout', 'Soccer Mommy', 'Nilufer Yanya',
    'Easy Life', 'Jerkcurb', 'Snail Mail', 'Sorry', 'QTY', 'Jarami', 'Yaeji', 'Promiseland', 'Park Hotel',
    'Vera', 'Keep Dancing Inc.', 'Bulow', 'Patawawa', 'Sassy 009', 'The Blaze', 'Tom Misch', 'Confidence Man',
    'Boy Azooga', 'Parcels', 'Octavian', 'Ms Banks', 'Yxng Bane', 'Avelino', 'Big Shaq', 'Not3s', 'A2',
    'Jevon',
  ],
  '2019': [
    '070 Shake', 'Alfie Templeman', 'Amelia Monet', 'Amyl & The Sniffers', 'Arlie', 'Art School Girlfriend',
    'Au/Ra', 'Avalanche Party', 'B-Young', 'Bad Gyal', 'Bakar', 'Beabadoobee', 'Billie Eilish', 'Black Midi',
    'Body Type', 'Boy Pablo', 'Cautious Clay', 'Chai', 'Channel Tres', 'Che Lingo', 'Cola Boyy', 'Conjurer',
    'Cuco', 'Dope Saint Jude', 'Dylan Cartlidge', 'Emerson Snowe', 'Feet', 'Flohio', 'Folamour',
    'Fontaines DC', 'Franc Moody', 'Fredo', 'Free Love', 'Fuzzy Sun', 'Glowie', 'Gouge Away', 'Grace Carter',
    'Haiku Hands', 'Hana Vu', 'Hannah Diamond', 'Hatchie', 'Headie One', 'Hermz 4k', 'Honey Gentry', 'Imbibe',
    'Jade Bird', 'Jesse Jo Stark', 'Jesus Piece', 'Jevon', 'Jimothy Lacoste', 'Just Banco', 'Knocked Loose',
    'Koffee', 'Kojaque', 'Leyma', 'Lucia', 'Mallrat', 'Master Peace', 'M.I.C', 'Millie Turner', 'MorMor',
    'The Night Cafe', 'No Rome', 'N0v3l', 'Octavian', 'Oracle Sisters', 'Osquello', 'Peggy Gou', 'Pizzagirl',
    'Pleasure Heads', 'Poppy Ajudha', 'Rascalton', 'Ravyn Lenae', 'Role Model', 'Rosalía', 'Ruby Fields',
    'Reykjavíkurdætur', 'Scarlxrd', 'Sea Girls', 'Serine Karthage', 'Sidney Gish', 'Slowthai', 'Snack Villain',
    'Spielbergs', 'Sports Team', 'Squid', 'Stella Donnelly', 'Surfbort', 'Tara Lily', 'Team Picture',
    'The Murder Capital', 'Unknown T', 'Vein', 'Westerman', 'whenyoung', 'Wicca Phase Springs Eternal',
    'Worstworldproblems', 'WWWater / Charlotte Adigery', 'Yizzy', 'Young T & Bugsey',
  ],
  '2020': [
    '100 gecs', 'Aitch', 'Allie X', 'AMA', 'Arlo Parks', 'Arxx', 'Baby Rose', 'Bamily', 'Banoffee',
    'Barny Fletcher', 'Bella Boo', 'BenjiFlow', 'Biig Piig', 'Black Country, New Road', 'Bob Vylan',
    'Buzzard Buzzard Buzzard', 'Celeste', 'Chinatown Slalom', 'Conan Gray', 'Creams', 'D-Block Europe',
    'Dayglow', 'Deaton Chris Anthony', 'Deb Never', 'Deep Tan', 'DigDat', 'Disq', 'Do Nothing', 'Dominic Fike',
    'Dry Cleaning', 'Ducks Unlimited', 'Finneas', 'Gia Ford', 'Girl In Red', 'Glossii', 'Greentea Peng',
    'Griff', 'HAAi', 'Hardy Caprio', 'INFAMOUSIZAK', 'Inhaler', 'Jay1', 'JGrrey', 'Joe and The Shitboys',
    'Joesef', 'Joy Crookes', 'Just Mustard', 'Katy J Pearson', 'Keshi', 'L Devine', 'Lacuna Common',
    'Larkins', 'Laundry Day', 'Lava La Rue', 'Lil Tecca', 'Lily Moore', 'LOLA', 'Mealtime', 'Miraa May',
    'Mk.gee', 'Moses Boyd', 'mxmtoon', 'The Mysterines', 'Nasty Cherry', 'NSG', 'Octo Octa', 'Omar Apollo',
    'Otha', 'Phoebe Green', 'Pillow Queens', 'Pongo', 'Porridge Radio', 'Pottery', 'Poundz',
    'Public Practice', 'Rachel Chinouriri', 'Safario', 'Sault', 'Shanti Celeste', 'Sinead O Brien',
    'Skengdo X AM', 'Skinny Living', 'SL', 'Social Contract', 'Steam Down', "T.Roadz", 'Talk Show',
    'The Muckers', 'The Wants', 'TIÑA', 'TSHA', 'Tyla Yaweh', 'Vegyn', 'Victoria Monét', 'Walt Disco',
    'Wooze', "Working Men's Club", 'YEBBA', 'Zack Villere', 'Zuzu',
  ],
  '2021': [
    '24kGoldn', 'Alaina Castillo', 'Alewya', 'Anxious', 'Ashnikko', 'Ashwarya', 'Baby Keem', 'Baby Queen',
    'BackRoad Gee', 'Bad Boy Chiller Crew', 'BERWYN', 'Bree Runway', 'Calabashed', 'Cat Burns',
    'Chloe Moriondo', 'Cj Pandit', 'Claud', 'CMAT', 'Courting', 'Daine', 'DEAR-GOD', 'Death Tour',
    'Demie Cao', 'Drug Store Romeos', 'Enny', 'Flo Milli', 'Folly Group', 'For Those I Love', 'Fousheé',
    'Fred again..', 'Frosty', 'Genesis Owusu', 'The Goa Express', 'Goya Gumbani', 'GRACEY', 'Gustaf',
    'Hollow Sinatra', 'Holly Humberstone', 'Hope Tala', 'India Jordan', 'Isola', 'Ivorian Doll', 'Jany Green',
    'Jockstrap', 'Joesef', 'Jordana', 'Josie Man', 'Kamal', 'KennyHoopla', 'Kid Kapichi', 'Kynsy',
    'The Lathums', 'The Lazy Eyes', 'Logic1000', 'Loose Articles', 'The Lounge Society', 'Lucy Deakin',
    'LustSickPuppy', 'Lynks', 'Malady', 'Marijannah', 'Martha Skye Murphy', 'Martyn Bootyspoon',
    'Meet Me @ The Altar', 'merci, mercy', 'MICHELLE', 'NAYANA IZ', 'NewDad', 'NOISY', 'Odeal', 'ONEFOUR',
    'Orion Sun', 'Pa Salieu', '박혜진 Park Hye Jin', 'Pixey', 'Powfu', 'Priya Ragu', 'PVA', 'Pyra', 'R.A.E',
    'Raheaven', 'Remi Wolf', 'Romero', 'Rose Gray', 'Scalping', 'Shaybo', 'Skullcrusher', 'Smoothboi Ezra',
    'The Snuts', 'Sofia Kourtesis', 'Spill Tab', 'Sprints', 'Tate McRae', 'Tayo Sound', 'Tiana Major9',
    'Wargasm',
  ],
  '2022': [
    'Aby Coulibaly', 'Adora', 'Amaarae', 'Anz', 'ArrDee', 'Ayra Starr', 'Aziya', 'Barkaa', 'BIBI', 'Binki',
    'Blu DeTiger', 'Blue Bendy', 'Bree Runway', 'Brooke Combe', 'Budjerah', 'caroline', 'Catcher',
    'Cathy Jain', 'Cayenne', 'Central Cee', 'COBRAH', 'Darkoo', 'Denise Chaila', 'dexter', 'Dora Jar',
    'Dreamer Isioma', 'Dvwn', 'Dylan Fraser', 'Eades', 'ekkstacy', 'emir taha', 'ena mori', 'English Teacher',
    'Enola Gay', 'ericdoa', 'Finn Askew', 'Flowerkid', 'Gabriels', 'glaive', 'Glass Beams', "Grandmas House",
    'Grazer', 'Grove', 'Grrrl Gang', 'HighSchool', 'Honeyglaze', 'Horsegirl', 'Infinite Coles', 'Irenegarry',
    'Jet Vesper', 'Junior Varsity', 'Kam-Bu', 'King Stingray', 'Lime Garden', 'Los Bitchos', 'Lucy Blue',
    'Luna Li', 'M(h)aol', 'Mandy, Indiana', 'MAY-A', 'Melin Melyn', 'Miso Extra', 'msftz', 'Nia Archives',
    'Nick Mono', 'Nippa', 'Nonô', 'Nukuluk', 'Paris Texas', 'PawPaw Rod', 'PinkPantheress', 'Pinkshift',
    'Piri and Tommy Villiers', 'Planet Giza', 'Priestgate', 'Prima Queen', 'Prospa', 'The Rills',
    'Sad Night Dynamite', 'Sarah Kinsley', 'Seori', 'SHERELLE', 'Shygirl', 'SIPHO.', 'STAYC', 'STONE',
    'Surya Sen', 'SwitchOTR', 'Sycco', 'TeeZee', 'Teezo Touchdown', 'Tems', 'The Umlauts', 'VLURE', 'Wallice',
    'Warren Hue', 'Wet Leg', 'Willow Kayne', 'Wunderhorse', 'Yunè Pinku',
  ],
  '2023': [
    '49th & Main', '1300', 'A1 x J1', 'Alice Longyu Gao', 'Anish Kumar', 'Babyface Mal', 'Balming Tiger',
    'BAYLI', 'Beckah Amani', 'Been Stellar', 'Bellah', 'Bingo Fury', 'Blazer Boccle', 'Blondshell',
    'Bloody Civilian', 'Caity Baser', 'Cassyette', 'Charlotte Plank', 'Clavish', 'Cowboyy', 'Crawlers',
    'Cucamaras', 'CVC', 'D4vd', 'Debbie', 'Dilaw', 'Doechii', 'Dolores Forever', 'Dylan', 'Eaves Wilder',
    'Eli Smart', 'Eliza Rose', 'ENOLA', 'Etta Marcus', 'FelixThe1st', 'FLO', 'Flower.far', 'Flowerovlove',
    'French The Kid', 'Girl Scout', 'GloRilla', 'Gretel Hänlyn', 'Guernica Club', 'Hannah Grae', 'Hazey',
    'Heartworms', 'Hemlocke Springs', 'Heriot', 'Humour', 'Ice Spice', 'Insincere', 'IVE', 'J. Maya',
    'Jim Legxacy', 'Katie Gregson-MacLeod', 'KhakiKid', 'Kinder Bloomen', 'Kneecap', 'Lambrini Girls',
    'Lana Lubany', 'LE SSERAFIM', 'Lee Young-ji', 'Mafro', 'Meekz', 'Milo Clare', 'MJ Nebreda', 'Monaleo',
    'Naked Lungs', 'Nell Mescal', 'Nemahsis', 'NewJeans', 'NMIXX', 'No Windows', 'O.', 'p-rallel',
    'Panic Shack', 'Redolent', 'Riovaz', 'Royel Otis', 'Ryan Castro', 'Sainté', 'Sam Austins', 'Sarah Wolfe',
    'Seachains', 'Skaiwater', 'Somadina', 'Sophie May', 'Speed', 'Surusinghe', 'Teeth Machine', 'Tendai',
    'The Dinner Party', 'The Heavy Heavy', 'The Short Causeway', 'Tommy Lefroy', 'Two Shell', 'Venbee',
    'Venna', 'Voice Of Baceprot', 'Waleed',
  ],
  '2025': [
    'Alemeda', 'Annahstasia', 'babyMINT', 'BADVILLAIN', 'Bambie Thug', 'Bassvictim', 'BEX', 'bib sama.',
    'Big Wett', 'Billianne', 'Black Fondu', 'Blusher', 'Cardinals', 'CARI', 'Ceechynaa', 'chest.',
    'Chloe Qisha', 'Chy Cartier', 'Clementine Douglas', 'DEELA', 'Deto Black', 'Divorce', 'Dog Race',
    'Duskus', 'Dust', 'Ebbb', 'Elestee', 'Elmiene', 'EMEREE', 'Esme Emerson', 'f5ve', 'FloyyMenor',
    'Folk Bitch Trio', 'Glixen', 'Gore.', 'Hang Linton', 'Hanumankind', 'Heartcoregirl', 'Her New Knife',
    'It Thing', 'Jacob Alon', 'Jacoténe', 'Jazzy', 'JD Cliffe', 'Jersey', 'Jessica Winter', 'Karen Dió',
    'KATSEYE', 'KiLLOWEN', 'Konyikeh', 'Kurayamisaka', 'Kwn', 'Leonie Biney', 'LeoStayTrill', 'Luvcat',
    'LVRA', 'Man/Woman/Chainsaw', 'Maruja', 'Megra', 'Miss Kaninna', 'Monobloc', 'Mudrat', 'Natanya',
    'Nate Sib', 'Nia Smith', 'October And The Eyes', 'Oreglo', 'Paige Kennedy', 'Pozer', 'Pretty Girl',
    'Radio Free Alice', 'Ratbag', 'Reble', 'RESCENE', 'Sailor Honeymoon', 'Sailorr', 'Sam Alfred',
    'Sex Week', 'SHEIVA', 'Shelhiel', 'Six Sex', 'Slow Fiction', 'SNAYX', 'Sofia Isella', 'Sophia Stel',
    'Star Bandz', 'Stella Bridie', 'Sunday (1994)', 'Tiberius b', 'Tsu Nami', 'TWS', 'Ugly', 'Valiant',
    'Welly', 'Westside Cowboy', 'Xaviersobased', 'YAANG', 'Yaeger', 'YHWH Nailgun', 'YT',
  ],
  '2026': [
    '2BYG', '54 Ultra', 'ADÉLA', 'After', "Ain't", 'Aleksiah', 'Amira Elfeky', 'Ashnymph', 'Baby DONT Cry',
    'Bleech 9:3', 'Blessing Jolie', 'BunnaB', 'Camille Yembe', 'Cannelle', 'Ceebo', 'Chrissi', 'Chuwi',
    'Ciel', 'Cliffords', 'Clutter', 'Comet', 'Cruush', 'Déyyess', 'Dolder', 'Gabriel Jacoby', 'Effie',
    'EJ Jones', 'Erin LeCount', 'Es.cher', 'Femtanyl', 'Florence Road', 'Girl Tones', 'Hearts2Hearts',
    'Heidi Curtis', 'Horsepower', 'ifeye', 'Jahnah Camille', "Jai'Len Josey", 'JayaHadADream',
    'Jessy Blakemore', 'Jett Blyton', 'June McDoom', 'Kidwild', 'KiiiKiii', 'Kloyd', 'KuleeAngee',
    'Leah Cleaver', 'Ledbyher', 'Lola Consuelos', 'Love Spells', 'Lucky', 'Lucky Iris', 'Maddie Ashman',
    'Madra Salach', 'Max Baby', 'Midrift', 'Moliy', 'Mother Soki', 'Ms* Gloom', 'My First Time',
    'Nadia Kadek', 'no na', 'Omar+', 'Oscar Farrell', 'Paira', 'Pollyfromthedirt', 'Proph', 'Punching Bag',
    'Reehaa', 'Rozie Ramati', 'Saam Sultan', 'Saint Clair', 'Sasha Keable', 'Sex Mask', "she's green",
    'She’s In Parties', 'Shelailai', 'Silverwingkiller', 'sim0ne', 'Skye Newman', 'Sleepazoid',
    'South Arcade', 'STARGLOW', 'Tatyana Jane', 'Teyma', 'The Itch', 'The Orchestra (For Now)',
    'The Paradox', 'The Sophs', 'Tkandz', 'Tommy WÁ', 'Tooth', 'TTSSFU', 'Twinboys', 'Unflirt', 'Villanelle',
    'Witch Post', 'XCOMM', 'Yaelokre',
  ],
}

function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().normalize('NFKC').replace(/\s+/g, ' ')
}

async function resolveArtistId(supabase: ReturnType<typeof createAdminClient>, name: string): Promise<{ id: string; matched: boolean }> {
  // 検索より先に、既に実データ登録済み(apple_music_artist_id有り)の同名
  // アーティストが無いか確認する(RADAR実行時、これを怠ったために重複行を
  // 大量に作ってしまった反省を反映)
  const { data: existingReal } = await supabase
    .from('artist')
    .select('id')
    .eq('name', name)
    .not('apple_music_artist_id', 'is', null)
    .maybeSingle()
  if (existingReal) return { id: existingReal.id, matched: true }

  let candidates: Awaited<ReturnType<typeof searchArtist>>
  try {
    candidates = await searchArtist(name)
  } catch (err) {
    console.error(`    検索失敗(${name}): ${(err as Error).message}`)
    candidates = []
  }

  const exactMatches = candidates.filter((c) => normalizeArtistName(c.artistName) === normalizeArtistName(name))

  if (exactMatches.length === 1) {
    const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, {
      wrapperType: 'artist',
      artistId: exactMatches[0].artistId,
      artistName: exactMatches[0].artistName,
      artistLinkUrl: exactMatches[0].artistLinkUrl,
    })
    if (artistId) return { id: artistId, matched: true }
    console.error(`    登録失敗(${name}): ${errorMessage}`)
  }

  // 候補0件・複数件・名前不一致の場合は誤登録を避け、名前のみの最小限スタブにする
  const { data: existingStub } = await supabase.from('artist').select('id').eq('name', name).is('apple_music_artist_id', null).maybeSingle()
  if (existingStub) return { id: existingStub.id, matched: false }

  const { data: inserted, error } = await supabase.from('artist').insert({ name }).select('id').single()
  if (error || !inserted) {
    throw new Error(`スタブ作成失敗(${name}): ${error?.message}`)
  }
  return { id: inserted.id, matched: false }
}

async function main() {
  const supabase = createAdminClient()

  const { data: existingRanking } = await supabase.from('ranking').select('id').eq('name', RANKING_NAME).maybeSingle()
  let rankingId: string
  if (existingRanking) {
    rankingId = existingRanking.id
  } else {
    const { data: created, error } = await supabase
      .from('ranking')
      .insert({
        name: RANKING_NAME,
        source: 'NME',
        list_type: 'selection',
        description:
          'NME誌が選ぶ、世界中の注目すべき新鋭アーティスト100組(2017年開始、毎年1月頃発表)。2024年は該当記事が見つからず欠年として扱う。',
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('企画の作成に失敗しました:', error?.message)
      process.exit(1)
    }
    rankingId = created.id
    console.log(`企画「${RANKING_NAME}」を作成しました(${rankingId})\n`)
  }

  let created = 0
  let skippedExisting = 0
  let matchedCount = 0
  let stubCount = 0

  for (const [year, names] of Object.entries(ROSTER)) {
    const periodDate = `${year}-01-01`
    console.log(`\n=== ${year}年(${names.length}組) ===`)

    for (const name of names) {
      const { id: artistId, matched } = await resolveArtistId(supabase, name)

      const { data: dupCheck } = await supabase
        .from('ranking_entry')
        .select('id')
        .eq('ranking_id', rankingId)
        .eq('period_date', periodDate)
        .eq('artist_id', artistId)
        .maybeSingle()
      if (dupCheck) {
        console.log(`  [既存] ${name}`)
        skippedExisting++
        continue
      }

      const { error: entryError } = await supabase.from('ranking_entry').insert({
        ranking_id: rankingId,
        period_date: periodDate,
        artist_id: artistId,
      })
      if (entryError) {
        console.error(`  [失敗] ${name}: ${entryError.message}`)
        continue
      }

      console.log(`  [${matched ? '一致' : 'スタブ'}] ${name}`)
      created++
      if (matched) matchedCount++
      else stubCount++
    }
  }

  console.log(`\n完了: 新規${created}件(Apple Music一致${matchedCount}件・スタブ${stubCount}件)、既存${skippedExisting}件スキップ。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
