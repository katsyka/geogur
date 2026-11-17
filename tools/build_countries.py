# Builds app/public/data/countries.json — the country universe for the Clues module.
# Only facts that are exact and stable: driving side, calling code, ccTLD, scripts, distinctive letters,
# plus a few well-established plate / road-line facts. Edit here, then re-run:  python3 tools/build_countries.py
import json, os

LAT = 'Latin'
SPANISH = 'ñáéíóúü'
FRENCH = 'àâæçéèêëîïôœùûüÿ'
CYR_SR = 'ђћџљњј'

# iso, name, region, drive, calling code, tld, scripts, distinctive letters
C = [
 # Europe
 ('AD','Andorra','Europe','R','+376','.ad',[LAT],'àèéíïòóúüç'),
 ('AL','Albania','Europe','R','+355','.al',[LAT],'çë'),
 ('AT','Austria','Europe','R','+43','.at',[LAT],'äöüß'),
 ('BA','Bosnia and Herzegovina','Europe','R','+387','.ba',[LAT,'Cyrillic'],'čćđšž'+CYR_SR),
 ('BE','Belgium','Europe','R','+32','.be',[LAT],'éèêëçàï'),
 ('BG','Bulgaria','Europe','R','+359','.bg',['Cyrillic'],'ъьйщ'),
 ('BY','Belarus','Europe','R','+375','.by',['Cyrillic'],'іўыэё'),
 ('CH','Switzerland','Europe','R','+41','.ch',[LAT],'äöüéèàç'),
 ('CY','Cyprus','Europe','L','+357','.cy',['Greek',LAT],''),
 ('CZ','Czechia','Europe','R','+420','.cz',[LAT],'áčďéěíňóřšťúůýž'),
 ('DE','Germany','Europe','R','+49','.de',[LAT],'äöüß'),
 ('DK','Denmark','Europe','R','+45','.dk',[LAT],'æøå'),
 ('EE','Estonia','Europe','R','+372','.ee',[LAT],'õäöüšž'),
 ('ES','Spain','Europe','R','+34','.es',[LAT],SPANISH+'ç'),
 ('FI','Finland','Europe','R','+358','.fi',[LAT],'äöå'),
 ('FO','Faroe Islands','Europe','R','+298','.fo',[LAT],'áðíóúýæø'),
 ('FR','France','Europe','R','+33','.fr',[LAT],FRENCH),
 ('GB','United Kingdom','Europe','L','+44','.uk',[LAT],'ŵŷ'),
 ('GI','Gibraltar','Europe','R','+350','.gi',[LAT],''),
 ('GR','Greece','Europe','R','+30','.gr',['Greek'],''),
 ('HR','Croatia','Europe','R','+385','.hr',[LAT],'čćđšž'),
 ('HU','Hungary','Europe','R','+36','.hu',[LAT],'áéíóöőúüű'),
 ('IE','Ireland','Europe','L','+353','.ie',[LAT],'áéíóú'),
 ('IM','Isle of Man','Europe','L','+44','.im',[LAT],''),
 ('IS','Iceland','Europe','R','+354','.is',[LAT],'áðéíóúýþæö'),
 ('IT','Italy','Europe','R','+39','.it',[LAT],'àèéìòù'),
 ('JE','Jersey','Europe','L','+44','.je',[LAT],''),
 ('LI','Liechtenstein','Europe','R','+423','.li',[LAT],'äöü'),
 ('LT','Lithuania','Europe','R','+370','.lt',[LAT],'ąčęėįšųūž'),
 ('LU','Luxembourg','Europe','R','+352','.lu',[LAT],'äëéè'),
 ('LV','Latvia','Europe','R','+371','.lv',[LAT],'āčēģīķļņšūž'),
 ('MC','Monaco','Europe','R','+377','.mc',[LAT],FRENCH),
 ('ME','Montenegro','Europe','R','+382','.me',[LAT,'Cyrillic'],'čćđšžśź'+CYR_SR),
 ('MK','North Macedonia','Europe','R','+389','.mk',['Cyrillic'],'ѓќѕџљњј'),
 ('MT','Malta','Europe','L','+356','.mt',[LAT],'ċġħżàèìòù'),
 ('NL','Netherlands','Europe','R','+31','.nl',[LAT],'ëïé'),
 ('NO','Norway','Europe','R','+47','.no',[LAT],'æøå'),
 ('PL','Poland','Europe','R','+48','.pl',[LAT],'ąćęłńóśźż'),
 ('PT','Portugal','Europe','R','+351','.pt',[LAT],'ãõçáâàéêíóôú'),
 ('RO','Romania','Europe','R','+40','.ro',[LAT],'ăâîșț'),
 ('RS','Serbia','Europe','R','+381','.rs',['Cyrillic',LAT],'čćđšž'+CYR_SR),
 ('RU','Russia','Europe','R','+7','.ru',['Cyrillic'],'ыэъёй'),
 ('SE','Sweden','Europe','R','+46','.se',[LAT],'åäö'),
 ('SI','Slovenia','Europe','R','+386','.si',[LAT],'čšž'),
 ('SK','Slovakia','Europe','R','+421','.sk',[LAT],'áäčďéíĺľňóôŕšťúýž'),
 ('SM','San Marino','Europe','R','+378','.sm',[LAT],'àèéìòù'),
 ('TR','Turkey','Europe','R','+90','.tr',[LAT],'çğıöşüâî'),
 ('UA','Ukraine','Europe','R','+380','.ua',['Cyrillic'],'іїєґ'),
 ('XK','Kosovo','Europe','R','+383','',[LAT,'Cyrillic'],'çë'+CYR_SR),
 ('AX','Åland','Europe','R','+358','.ax',[LAT],'åäö'),
 ('SJ','Svalbard','Europe','R','+47','.sj',[LAT],'æøå'),
 ('GE','Georgia','Asia','R','+995','.ge',['Georgian',LAT],''),
 ('GL','Greenland','Americas','R','+299','.gl',[LAT],'æøå'),
 # Asia
 ('JP','Japan','Asia','L','+81','.jp',['Japanese'],''),
 ('KR','South Korea','Asia','R','+82','.kr',['Hangul'],''),
 ('TW','Taiwan','Asia','R','+886','.tw',['Chinese'],''),
 ('HK','Hong Kong','Asia','L','+852','.hk',['Chinese',LAT],''),
 ('MO','Macau','Asia','L','+853','.mo',['Chinese',LAT],'ãçéõ'),
 ('TH','Thailand','Asia','L','+66','.th',['Thai'],''),
 ('MY','Malaysia','Asia','L','+60','.my',[LAT,'Chinese','Tamil'],''),
 ('SG','Singapore','Asia','L','+65','.sg',[LAT,'Chinese','Tamil'],''),
 ('ID','Indonesia','Asia','L','+62','.id',[LAT],''),
 ('PH','Philippines','Asia','R','+63','.ph',[LAT],'ñ'),
 ('KH','Cambodia','Asia','R','+855','.kh',['Khmer'],''),
 ('LA','Laos','Asia','R','+856','.la',['Lao'],''),
 ('VN','Vietnam','Asia','R','+84','.vn',[LAT],'ăâđêôơư'),
 ('IN','India','Asia','L','+91','.in',['Devanagari',LAT,'Bengali','Tamil'],''),
 ('BD','Bangladesh','Asia','L','+880','.bd',['Bengali'],''),
 ('LK','Sri Lanka','Asia','L','+94','.lk',['Sinhala','Tamil'],''),
 ('BT','Bhutan','Asia','L','+975','.bt',['Tibetan',LAT],''),
 ('NP','Nepal','Asia','L','+977','.np',['Devanagari'],''),
 ('MN','Mongolia','Asia','R','+976','.mn',['Cyrillic'],'өү'),
 ('KZ','Kazakhstan','Asia','R','+7','.kz',['Cyrillic'],'әғқңөұүһі'),
 ('KG','Kyrgyzstan','Asia','R','+996','.kg',['Cyrillic'],'ңөү'),
 ('IL','Israel','Asia','R','+972','.il',['Hebrew','Arabic'],''),
 ('PS','Palestine','Asia','R','+970','.ps',['Arabic'],''),
 ('JO','Jordan','Asia','R','+962','.jo',['Arabic'],''),
 ('LB','Lebanon','Asia','R','+961','.lb',['Arabic',LAT],FRENCH),
 ('AE','United Arab Emirates','Asia','R','+971','.ae',['Arabic'],''),
 ('QA','Qatar','Asia','R','+974','.qa',['Arabic'],''),
 ('OM','Oman','Asia','R','+968','.om',['Arabic'],''),
 ('PK','Pakistan','Asia','L','+92','.pk',['Arabic',LAT],''),
 ('CN','China','Asia','R','+86','.cn',['Chinese'],''),
 # Africa
 ('ZA','South Africa','Africa','L','+27','.za',[LAT],'êëôï'),
 ('LS','Lesotho','Africa','L','+266','.ls',[LAT],''),
 ('SZ','Eswatini','Africa','L','+268','.sz',[LAT],''),
 ('BW','Botswana','Africa','L','+267','.bw',[LAT],''),
 ('NA','Namibia','Africa','L','+264','.na',[LAT],'êëôï'),
 ('KE','Kenya','Africa','L','+254','.ke',[LAT],''),
 ('UG','Uganda','Africa','L','+256','.ug',[LAT],''),
 ('TZ','Tanzania','Africa','L','+255','.tz',[LAT],''),
 ('RW','Rwanda','Africa','R','+250','.rw',[LAT],''),
 ('GH','Ghana','Africa','R','+233','.gh',[LAT],'ɛɔ'),
 ('NG','Nigeria','Africa','R','+234','.ng',[LAT],'ẹọṣ'),
 ('SN','Senegal','Africa','R','+221','.sn',[LAT],FRENCH),
 ('ML','Mali','Africa','R','+223','.ml',[LAT],FRENCH),
 ('TN','Tunisia','Africa','R','+216','.tn',['Arabic',LAT],FRENCH),
 ('EG','Egypt','Africa','R','+20','.eg',['Arabic'],''),
 ('MG','Madagascar','Africa','R','+261','.mg',[LAT],FRENCH),
 ('RE','Réunion','Africa','R','+262','.re',[LAT],FRENCH),
 ('ST','São Tomé and Príncipe','Africa','R','+239','.st',[LAT],'ãõçáâàéêíóôú'),
 # Americas
 ('US','United States','Americas','R','+1','.us',[LAT],''),
 ('CA','Canada','Americas','R','+1','.ca',[LAT],'éèêàçëïôûù'),
 ('MX','Mexico','Americas','R','+52','.mx',[LAT],SPANISH),
 ('GT','Guatemala','Americas','R','+502','.gt',[LAT],SPANISH),
 ('CR','Costa Rica','Americas','R','+506','.cr',[LAT],SPANISH),
 ('PA','Panama','Americas','R','+507','.pa',[LAT],SPANISH),
 ('DO','Dominican Republic','Americas','R','+1','.do',[LAT],SPANISH),
 ('PR','Puerto Rico','Americas','R','+1','.pr',[LAT],SPANISH),
 ('VI','U.S. Virgin Islands','Americas','L','+1','.vi',[LAT],''),
 ('BM','Bermuda','Americas','L','+1','.bm',[LAT],''),
 ('CW','Curaçao','Americas','R','+599','.cw',[LAT],'èòùü'),
 ('PM','Saint Pierre and Miquelon','Americas','R','+508','.pm',[LAT],FRENCH),
 ('FK','Falkland Islands','Americas','L','+500','.fk',[LAT],''),
 ('CO','Colombia','Americas','R','+57','.co',[LAT],SPANISH),
 ('EC','Ecuador','Americas','R','+593','.ec',[LAT],SPANISH),
 ('PE','Peru','Americas','R','+51','.pe',[LAT],SPANISH),
 ('BO','Bolivia','Americas','R','+591','.bo',[LAT],SPANISH),
 ('CL','Chile','Americas','R','+56','.cl',[LAT],SPANISH),
 ('AR','Argentina','Americas','R','+54','.ar',[LAT],SPANISH),
 ('UY','Uruguay','Americas','R','+598','.uy',[LAT],SPANISH),
 ('PY','Paraguay','Americas','R','+595','.py',[LAT],SPANISH),
 ('BR','Brazil','Americas','R','+55','.br',[LAT],'ãõçáâàéêíóôú'),
 # Oceania
 ('AU','Australia','Oceania','L','+61','.au',[LAT],''),
 ('NZ','New Zealand','Oceania','L','+64','.nz',[LAT],'āēīōū'),
 ('CX','Christmas Island','Oceania','L','+61','.cx',[LAT],''),
 ('CC','Cocos (Keeling) Islands','Oceania','L','+61','.cc',[LAT],''),
 ('PN','Pitcairn Islands','Oceania','L','+64','.pn',[LAT],''),
 ('AS','American Samoa','Oceania','R','+1','.as',[LAT],'āēīōū'),
 ('GU','Guam','Oceania','R','+1','.gu',[LAT],'åñ'),
 ('MP','Northern Mariana Islands','Oceania','R','+1','.mp',[LAT],'åñ'),
]

# NANP area codes, so "+1 809" etc. can be told apart.
NANP = {'US':'many','CA':'many','DO':'809, 829, 849','PR':'787, 939','VI':'340','BM':'441','AS':'684','GU':'671','MP':'670'}

EU = set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split())

# Facts: id -> (label, group, countries, strength, note)
FACTS = {
 'plate_eu':          ('Blue EU strip on plates', 'Plates', EU, 'strong',
                       'Standard on EU member-state plates. Several non-EU countries use a similar blue strip with their own flag (e.g. Ukraine, Serbia, Turkey, Albania, Norway), so check the strip for the EU stars.'),
 'plate_mercosur':    ('Mercosur plates (blue top band)', 'Plates', {'AR','BR','PY','UY'}, 'strong',
                       'White plate with a blue band across the top naming the country.'),
 'plate_yellow_both': ('Yellow plates, front and rear', 'Plates', {'NL','LU','IL','CO'}, 'strong',
                       'Private cars. Colombia: yellow plates with black letters.'),
 'plate_yellow_rear': ('White front plate, yellow rear plate', 'Plates', {'GB','GI','IM','JE','CY','KE','UG','RW','BW','SG','LK'}, 'strong',
                       'Cyprus: 2004-2013 plates; current plates are white front and rear. Singapore: black plates are also common.'),
 'plate_black':       ('Black plates, white characters', 'Plates', {'MY','ST','TN','LI','MG'}, 'strong',
                       'Also on older plates elsewhere: Indonesia (2011-2022), Argentina (1995-2016).'),
 'speed_mph':         ('Speed limits in mph', 'Roads', {'US','GB','IM','JE','PR','VI','AS','GU','MP','FK'}, 'strong',
                       'Puerto Rico: speed in mph but distances in km. Gibraltar and Bermuda use km/h.'),
}

# Road-line colour combinations seen in each country (edge / centre), from research/road_lines.json.
# A country can appear in several: the list says the combination occurs there, not that it is the only one.
LINE_LABELS = {
 'whiteWhite': 'White edge, white centre', 'yellowWhite': 'Yellow edge, white centre',
 'whiteYellow': 'White edge, yellow centre', 'yellowYellow': 'Yellow edge, yellow centre',
 'whiteWhiteYellow': 'White edge, white and yellow centre',
}
ALIASES = {'Czech Republic': 'CZ', 'United States Virgin Islands': 'VI', 'Macao': 'MO', 'Svalbard and Jan Mayen': 'SJ'}
NAME_TO_ISO = {name: iso for iso, name, *_ in C}
NAME_TO_ISO.update(ALIASES)
with open(os.path.join(os.path.dirname(__file__), '..', 'research', 'road_lines.json')) as f:
    lines = json.load(f)
for key, label in LINE_LABELS.items():
    isos = {NAME_TO_ISO[n] for n in lines[key] if n in NAME_TO_ISO}
    FACTS['line_' + key] = (label, 'Road lines', isos, 'common', 'Seen in at least part of the country.')

out = []
for iso, name, region, drive, phone, tld, scripts, letters in C:
    out.append({
        'iso': iso, 'name': name, 'region': region, 'drive': drive,
        'phone': phone, 'nanp': NANP.get(iso), 'tld': tld,
        'scripts': scripts, 'letters': ''.join(dict.fromkeys(letters)),
        'facts': sorted(k for k, v in FACTS.items() if iso in v[2]),
    })
isos = {c['iso'] for c in out}
for k, v in FACTS.items():
    missing = v[2] - isos
    assert not missing, (k, missing)

doc = {
    'countries': out,
    'facts': {k: {'label': v[0], 'group': v[1], 'strength': v[3], 'note': v[4]} for k, v in FACTS.items()},
    'note': 'Country list ≈ places with official Google Street View coverage (approximate).',
}
dst = os.path.join(os.path.dirname(__file__), '..', 'app', 'public', 'data', 'countries.json')
with open(dst, 'w') as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print(len(out), 'countries ->', os.path.normpath(dst))
