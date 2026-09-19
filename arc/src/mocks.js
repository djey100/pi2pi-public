// pi2pi mock data (ES module)
import { t } from './i18n/index.js';

// pi2pi mock data — demo listings and tenants (Phase C3)
// Loaded via <script> after i18n-en.js (uses t() for translations).

// City coordinates for map display
const CITY_COORDS = {
  "Tbilisi, Georgia": [41.7151, 44.8271],
  "Batumi, Georgia": [41.6458, 41.6419],
  "Da Nang, Vietnam": [16.0544, 108.2022],
  "Ho Chi Minh City, Vietnam": [10.7769, 106.7009],
  "Nha Trang, Vietnam": [12.2388, 109.1967],
  "Hanoi, Vietnam": [21.0285, 105.8542],
  "Buenos Aires, Argentina": [-34.6037, -58.3816],
  "São Paulo, Brazil": [-23.5505, -46.6333],
  "Bangkok, Thailand": [13.7563, 100.5018],
  "Samui, Thailand": [9.5120, 100.0670],
  "Phuket, Thailand": [7.8804, 98.3923],
};

export const LISTINGS = [
  { id:0, image:"/images/tbilisi-sunset.jpg", title:t("mock.title_0"), location:"Tbilisi, Georgia", lat:41.7080, lng:44.7930, price:420, rating:4.97, reviews:128, beds:3, baths:2, sqm:180, tag:t("mock.tag_top_rated"), host:"Nino Beridze", hostAvatar:"nino", viewingsHosted:47, rented:12, desc:t("mock.desc_0"), amenities:["Smart Lock","Pool","Gym","Concierge","EV Parking","Fiber"], contract:"0x1f7c...b334" },
  { id:1, image:"/images/danang-2.jpg", title:t("mock.title_1"), location:"Da Nang, Vietnam", lat:16.0610, lng:108.2180, price:500, rating:5.0, reviews:0, beds:1, baths:1, sqm:55, tag:t("mock.tag_new"), host:"Alex Chen", hostAvatar:"alex", viewingsHosted:0, rented:0, desc:t("mock.desc_1"), amenities:["Smart Lock","Pool","Gym","Fiber","AC"], contract:"0x4a3b...f91c", _owner:"login-landlord" },
  { id:2, image:"/images/buenos-aires-1.jpg", title:t("mock.title_2"), location:"Buenos Aires, Argentina", lat:-34.5820, lng:-58.4270, price:520, rating:4.89, reviews:94, beds:1, baths:1, sqm:75, tag:t("mock.tag_new"), host:"Mia Torres", hostAvatar:"mia", viewingsHosted:31, rented:8, desc:t("mock.desc_2"), amenities:["Smart Lock","Rooftop","Co-working","Fiber"], contract:"0x8d2e...a07f" },
  { id:3, image:"/images/danang-4.jpg", title:t("mock.title_3"), location:"Tbilisi, Georgia", lat:41.6940, lng:44.8010, price:380, rating:4.82, reviews:47, beds:1, baths:1, sqm:42, tag:t("mock.tag_below_market"), host:"Tamara Kvariani", hostAvatar:"alex", viewingsHosted:18, rented:4, desc:t("mock.desc_3"), amenities:["Smart Lock","Fiber","AC","Balcony"], contract:"0x2c9f...a114" },
  { id:4, image:"/images/sao-paulo.jpg", title:t("mock.title_4"), location:"Da Nang, Vietnam", lat:16.0380, lng:108.2460, price:380, rating:5.0, reviews:61, beds:4, baths:3, sqm:320, tag:t("mock.tag_verified"), host:"Wayan Sari", hostAvatar:"wayan", viewingsHosted:22, rented:6, desc:t("mock.desc_4"), amenities:["Private Pool","Beach","Chef","Solar","Smart Lock"], contract:"0x9a4d...c821" },
  { id:5, image:"/images/buenos-aires-2.jpg", title:t("mock.title_5"), location:"Buenos Aires, Argentina", lat:-34.5880, lng:-58.4120, price:680, rating:4.91, reviews:73, beds:2, baths:1, sqm:90, tag:t("mock.tag_top_rated"), host:"Carlos Méndez", hostAvatar:"marco", viewingsHosted:34, rented:9, desc:t("mock.desc_5"), amenities:["Smart Lock","Rooftop","Parking","Fiber","Dishwasher"], contract:"0x7b1d...c552" },
  { id:6, image:"/images/danang-3.jpg", title:t("mock.title_6"), location:"Tbilisi, Georgia", lat:41.7210, lng:44.7680, price:450, rating:4.95, reviews:102, beds:1, baths:1, sqm:58, tag:t("mock.tag_verified"), host:"Giorgi Lomidze", hostAvatar:"alex", viewingsHosted:40, rented:11, desc:t("mock.desc_6"), amenities:["Smart Lock","Gym","Concierge","Fiber","EV Parking"], contract:"0x5c3b...e771" },
  { id:7, image:"/images/tbilisi-day.jpg", title:t("mock.title_7"), location:"Da Nang, Vietnam", lat:16.0590, lng:108.2470, price:420, rating:4.78, reviews:29, beds:1, baths:1, sqm:38, tag:t("mock.tag_new"), host:"Nguyen Linh", hostAvatar:"wayan", viewingsHosted:11, rented:2, desc:t("mock.desc_7"), amenities:["Smart Lock","Fiber","AC","Sea View"], contract:"0x3e8a...b229" },
  { id:8, image:"/images/buenos-aires-3.jpg", title:t("mock.title_8"), location:"Buenos Aires, Argentina", lat:-34.5870, lng:-58.3930, price:590, rating:4.86, reviews:58, beds:1, baths:1, sqm:65, tag:t("mock.tag_verified"), host:"Valentina Ruiz", hostAvatar:"mia", viewingsHosted:26, rented:7, desc:t("mock.desc_8"), amenities:["Smart Lock","Doorman","Fiber","AC","Balcony"], contract:"0x6d4c...f883" },
  { id:9, image:"/images/tbilisi-sunset.jpg", title:t("mock.title_9"), location:"Tbilisi, Georgia", lat:41.7270, lng:44.7460, price:400, rating:4.88, reviews:84, beds:2, baths:1, sqm:82, tag:t("mock.tag_top_rated"), host:"Ana Tsiklauri", hostAvatar:"nino", viewingsHosted:38, rented:10, desc:t("mock.desc_9"), amenities:["Smart Lock","Parking","Fiber","AC","Storage"], contract:"0xb3a1...7f62" },
  { id:10, image:"/images/buenos-aires-4.jpg", title:t("mock.title_10"), location:"Da Nang, Vietnam", lat:16.0720, lng:108.2240, price:460, rating:4.73, reviews:21, beds:1, baths:1, sqm:48, tag:t("mock.tag_new"), host:"Pham Duc Anh", hostAvatar:"alex", viewingsHosted:8, rented:1, desc:t("mock.desc_10"), amenities:["Smart Lock","River View","Fiber","AC","Gym"], contract:"0x9f2e...d340" },
  { id:11, image:"/images/danang-5.jpg", title:t("mock.title_11"), location:"Buenos Aires, Argentina", lat:-34.5640, lng:-58.4560, price:550, rating:4.80, reviews:36, beds:1, baths:1, sqm:70, tag:t("mock.tag_new"), host:"Matías Herrera", hostAvatar:"marco", viewingsHosted:14, rented:3, desc:t("mock.desc_11"), amenities:["Smart Lock","Rooftop","Fiber","AC","Co-working"], contract:"0xc7d8...3b04" },
  { id:12, image:"/images/tbilisi-day.jpg", title:t("mock.title_12"), location:"Tbilisi, Georgia", lat:41.7150, lng:44.7830, price:560, rating:4.90, reviews:67, beds:3, baths:2, sqm:130, tag:t("mock.tag_verified"), host:"David Gabrichidze", hostAvatar:"alex", viewingsHosted:29, rented:8, desc:t("mock.desc_12"), amenities:["Smart Lock","Concierge","Parking","Gym","Fiber","EV Parking"], contract:"0xe2f0...9c35" },
  { id:13, image:"/images/sao-paulo.jpg", title:t("mock.title_13"), location:"Da Nang, Vietnam", lat:16.0310, lng:108.2530, price:650, rating:4.96, reviews:55, beds:3, baths:2, sqm:210, tag:t("mock.tag_top_rated"), host:"Tran Thi Mai", hostAvatar:"wayan", viewingsHosted:20, rented:6, desc:t("mock.desc_13"), amenities:["Private Pool","Garden","Smart Lock","Fiber","Solar","AC"], contract:"0xd5e9...2a17" },
];
export const TENANTS = [
  { id:101, name:"Yuki Tanaka", avatar:"yuki", title:"Looking for 1BR in Da Nang", area:"Da Nang, Vietnam", rooms:"1", mr:500, verified:true, viewingsReq:4, rentals:2, _owner:"login-tenant" },
  { id:102, name:"Priya Shah", avatar:"priya", title:"Studio or 1BR, Buenos Aires", area:"Buenos Aires, Argentina", rooms:"1", mr:520, verified:true, viewingsReq:9, rentals:5 },
  { id:103, name:"Marco Ricci", avatar:"marco", title:"2BR apartment, Tbilisi", area:"Tbilisi, Georgia", rooms:"2", mr:420, verified:false, viewingsReq:1, rentals:0 },
  { id:104, name:"Lena Svanidze", avatar:"nino", title:"Quiet 1BR near Vake Park, Tbilisi", area:"Tbilisi, Georgia", rooms:"1", mr:440, verified:true, viewingsReq:6, rentals:3 },
  { id:105, name:"Rafael Torres", avatar:"marco", title:"Studio in Palermo or Belgrano", area:"Buenos Aires, Argentina", rooms:"1", mr:530, verified:true, viewingsReq:12, rentals:6 },
  { id:106, name:"Hana Nguyen", avatar:"wayan", title:"1BR close to My Khe beach", area:"Da Nang, Vietnam", rooms:"1", mr:420, verified:true, viewingsReq:3, rentals:1 },
  { id:107, name:"Sandro Beridze", avatar:"alex", title:"2BR or larger, Tbilisi centre", area:"Tbilisi, Georgia", rooms:"2", mr:480, verified:false, viewingsReq:5, rentals:0 },
  { id:108, name:"Camila Vega", avatar:"mia", title:"2BR apartment, Recoleta preferred", area:"Buenos Aires, Argentina", rooms:"2", mr:650, verified:true, viewingsReq:7, rentals:4 },
  { id:109, name:"Minh Tuan Pham", avatar:"alex", title:"Studio or 1BR, Han River area", area:"Da Nang, Vietnam", rooms:"1", mr:460, verified:true, viewingsReq:2, rentals:1 },
  { id:110, name:"Ekaterine Mgeladze", avatar:"nino", title:"3BR family flat, Tbilisi", area:"Tbilisi, Georgia", rooms:"3", mr:550, verified:true, viewingsReq:8, rentals:3 },
  { id:111, name:"Diego Morales", avatar:"marco", title:"1BR loft, Buenos Aires", area:"Buenos Aires, Argentina", rooms:"1", mr:560, verified:false, viewingsReq:4, rentals:0 },
  { id:112, name:"Linh Phuong Tran", avatar:"wayan", title:"Villa or large flat, Da Nang", area:"Da Nang, Vietnam", rooms:"3", mr:640, verified:true, viewingsReq:5, rentals:2 },
  { id:113, name:"Ani Gogoladze", avatar:"nino", title:"Cosy studio, Old Town Tbilisi", area:"Tbilisi, Georgia", rooms:"1", mr:390, verified:true, viewingsReq:10, rentals:5 },
];
