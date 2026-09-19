// Listing Wizard configuration data

export const LW_CITIES = {
  "Tbilisi, Georgia": {
    districts: ["Vake","Vera","Saburtalo","Old Town","Mtatsminda","Didube","Gldani","Isani","Nadzaladevi","Other"],
    centers: {
      "Vake":[41.7099,44.7615],"Vera":[41.7150,44.7790],"Saburtalo":[41.7250,44.7400],
      "Old Town":[41.6920,44.8060],"Mtatsminda":[41.6940,44.7860],"Didube":[41.7350,44.7750],
      "Gldani":[41.7550,44.7800],"Isani":[41.6950,44.8200],"Nadzaladevi":[41.7400,44.7900],
      "Other":[41.7151,44.8271],
    }
  },
  "Batumi, Georgia": {
    districts: ["Old Batumi","New Boulevard","Gonio","Other"],
    centers: {
      "Old Batumi":[41.6458,41.6419],"New Boulevard":[41.6530,41.6350],"Gonio":[41.5730,41.5780],
      "Other":[41.6458,41.6419],
    }
  },
  "Da Nang, Vietnam": {
    districts: ["Hai Chau","Thanh Khe","Son Tra","Ngu Hanh Son","Lien Chieu","Cam Le","Other"],
    centers: {
      "Hai Chau":[16.0544,108.2022],"Thanh Khe":[16.0670,108.1850],"Son Tra":[16.1050,108.2500],
      "Ngu Hanh Son":[16.0200,108.2500],"Lien Chieu":[16.0800,108.1500],"Cam Le":[16.0200,108.2000],
      "Other":[16.0544,108.2022],
    }
  },
  "Ho Chi Minh City, Vietnam": {
    districts: ["District 1","District 2 (Thu Duc)","District 7","Binh Thanh","Other"],
    centers: {
      "District 1":[10.7769,106.7009],"District 2 (Thu Duc)":[10.7870,106.7500],"District 7":[10.7340,106.7220],
      "Binh Thanh":[10.8010,106.7100],"Other":[10.7769,106.7009],
    }
  },
  "Nha Trang, Vietnam": {
    districts: ["City Center","Tran Phu Beach","Vinh Hai","Other"],
    centers: {
      "City Center":[12.2388,109.1967],"Tran Phu Beach":[12.2450,109.1950],"Vinh Hai":[12.2600,109.2000],
      "Other":[12.2388,109.1967],
    }
  },
  "Hanoi, Vietnam": {
    districts: ["Hoan Kiem","Ba Dinh","Tay Ho","Cau Giay","Other"],
    centers: {
      "Hoan Kiem":[21.0285,105.8542],"Ba Dinh":[21.0340,105.8190],"Tay Ho":[21.0650,105.8200],
      "Cau Giay":[21.0310,105.7900],"Other":[21.0285,105.8542],
    }
  },
  "Buenos Aires, Argentina": {
    districts: ["Palermo","Recoleta","Belgrano","San Telmo","Puerto Madero","Caballito","Villa Crespo","Other"],
    centers: {
      "Palermo":[-34.5800,-58.4270],"Recoleta":[-34.5870,-58.3930],"Belgrano":[-34.5640,-58.4560],
      "San Telmo":[-34.6200,-58.3700],"Puerto Madero":[-34.6100,-58.3600],"Caballito":[-34.6180,-58.4400],
      "Villa Crespo":[-34.5990,-58.4380],"Other":[-34.6037,-58.3816],
    }
  },
  "São Paulo, Brazil": {
    districts: ["Vila Madalena","Pinheiros","Jardins","Moema","Other"],
    centers: {
      "Vila Madalena":[-23.5530,-46.6910],"Pinheiros":[-23.5670,-46.6930],"Jardins":[-23.5640,-46.6650],
      "Moema":[-23.6010,-46.6650],"Other":[-23.5505,-46.6333],
    }
  },
  "Bangkok, Thailand": {
    districts: ["Sukhumvit","Silom","Sathorn","Ari","Other"],
    centers: {
      "Sukhumvit":[13.7370,100.5600],"Silom":[13.7260,100.5230],"Sathorn":[13.7190,100.5290],
      "Ari":[13.7790,100.5450],"Other":[13.7563,100.5018],
    }
  },
  "Samui, Thailand": {
    districts: ["Chaweng","Lamai","Bophut","Other"],
    centers: {
      "Chaweng":[9.5280,100.0770],"Lamai":[9.4780,100.0680],"Bophut":[9.5360,100.0170],
      "Other":[9.5120,100.0670],
    }
  },
  "Phuket, Thailand": {
    districts: ["Patong","Rawai","Kamala","Other"],
    centers: {
      "Patong":[7.8960,98.3020],"Rawai":[7.7780,98.3250],"Kamala":[7.9520,98.2830],
      "Other":[7.8804,98.3923],
    }
  },
};

export const LW_CITY_LIST = Object.keys(LW_CITIES);
export const LW_DISTRICTS = LW_CITIES["Tbilisi, Georgia"].districts; // default fallback
export const LW_DISTRICT_CENTERS = Object.values(LW_CITIES).reduce((acc, c) => ({...acc, ...c.centers}), {});
export const LW_PROPERTY_TYPES = ["Studio","1BR","2BR","3BR","House","Room"];
export const LW_MIN_STAY = [6,12,18,24];
export const LW_QUICK_RENT = [500, 800, 1200, 1800];
export const LW_PHOTO_CAPTIONS = ["Living","Bedroom","Kitchen","Bathroom","View","Balcony","Other"];
export const LW_AMENITY_GROUPS = [
  { label:"Furniture & Basics",  items:["Furnished","Unfurnished","Bed","Sofa","Table","Closet","Iron","Hangers"] },
  { label:"Kitchen",             items:["Full kitchen","Fridge","Microwave","Oven","Dishwasher","Coffee maker","Kettle"] },
  { label:"Comfort",             items:["WiFi","TV","AC","Heating","Washer","Dryer","Balcony","Elevator"] },
  { label:"Building & Outside",  items:["Parking","Storage","Garden","Terrace","Pool"] },
  { label:"Rules",               items:["Pets OK","Smoking OK","Kids OK","Couples OK","Long-term only","Smoke alarm","First aid kit"] },
];

export function lwCompressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1920;
        let w = img.width, h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
          else       { w = Math.round(w * maxSide / h); h = maxSide; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("compress_failed")), "image/jpeg", 0.8);
      };
      img.onerror = () => reject(new Error("img_load_failed"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export const LW_DRAFT_KEY = (addr) => "pi2pi_wizard_draft_" + (addr || "anon").toLowerCase();
export const LW_BLANK_STATE = {
  city: "",
  district: "",
  address: "",
  zone_lat: null,
  zone_lng: null,
  property_type: "Studio",
  floor: "",
  monthly_rent: "",
  min_stay_months: 6,
  amenities: [],
  photos: [], // [{cid, caption}]
  description: "",
  description_mode: "auto",
  description_prompts: { special: "", neighborhood: "" },
};
