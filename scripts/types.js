// scripts/types.js
export const TYPES = {
  link: "link",
  text: "text",
  list: "list",
  downloads: "download",
  photo: "photo",
  news: "news",
  event: "event"
};

export const TYPE_CONFIG = {
  link: {
    hash: "link",

    // Category UI
    addCategoryBtn: "#link-add",
    categoryForm: "#link-cat-form",
    categoryName: "#group_name",
    accessGroup: "#isPublic",
    publicLabel: "#Public",
    searchInput: "#link-cat-search-input, #link-search-input",
    searchBtn: "#link-cat-search-btn, #link-search-btn",

    maxWidth: "#StandardMaxWidth",
    maxHeight: "#StandardMaxHeight",
    defaultMaxWidth: "2400",
    defaultMaxHeight: "2400",

    saveAndAddItem: "#btnSaveAdd",

    // Item UI
    addItemBtn: "#btnAddLink",
    itemTitle: "#tb-link-title",
    itemUrl: "#tb-link-url",
    itemDescriptionIframe: "#fldDescription_ifr",

    // ✅ Image upload inputs (scoped)
    primaryImageInput: "#file-upload-region input.file-upload-input",
    hoverImageInput: "#hover-file-upload-region input.file-upload-input",

    // ✅ Image preview cells (authoritative)
    primaryImageCell: "#photoImageCell",
    hoverImageCell: "#hoverPhotoImageCell",

    saveItem: "#btnSaveLink"
  },

  text: {
    hash: "text",

    // Category UI
    addCategoryBtn: "#text-add",
    categoryForm: "#text-cat-form",
    categoryName: "#Name",
    accessGroup: "#isPublic",
    publicLabel: "#Public",
    
    // Search
    searchInput: "#text-search-input",
    searchBtn: "#text-search-btn",

    // Save & edit
    saveAndEdit: "#btnSaveAndEdit",

    // Editor
    longTextIframe: "#LongText_ifr",
    saveEdit: "#btnSave"
  },

  list: {
    hash: "list",

    // Category UI
    addCategoryBtn: "#list-add",
    categoryForm: "#list-cat-form",
    categoryName: "#Name",
    accessGroup: "#isPublic",
    publicLabel: "#Public",
    searchInput: "#list-cat-search-input, #list-search-input",
    searchBtn: "#list-cat-search-btn, #list-search-btn",
    maxImages: "#ImageMax",
    saveAndAddItem: "#btnSaveAddList",

    // Item UI
    addItemBtn: "#btnAddList",
    itemTitle: "#Title",
    itemShortDescIframe: "#fldShortDescription_ifr",
    itemLongDescIframe: "#fldLongDescription_ifr",

    // Upload UI
    imageDropZone: "#fileupload",
    imageInput: "input.file-upload-input",
    photoTable: "#photo_table",

    saveItem: "#btnSave",

    // Organize / reorder UI
    organizeBtn: "#btnOrganize",
    sortAddedAscBtn: "#btnSortDateAsc",
    saveOrderBtn: "#btnSave",

  },
  download: {
    hash: "download",

    addCategoryBtn: "#download-add",
    categoryForm: "#download-cat-form",
    categoryName: "#Name",
    searchInput: "#download-cat-search-input, #download-search-input",
    searchBtn: "#download-cat-search-btn, #download-search-btn",

    accessGroup: "#isPublic",
    publicLabel: "#Public",

    categoryDescriptionIframe: "#txtLongDescription_ifr",
    saveAndAddItem: "#btnSaveAndAddDownload",

    addItemBtn: "#btnAddDownload",

    itemTitle: "#tb-download-title",
    itemDescriptionIframe: "#fldDescription_ifr",

    fileInput: "input.fs-local-input",
    saveItem: "#btnSaveDownload",

    // ✅ FINAL authoritative boundary
    uploadProgressSelector: ".progress, .progress-bar"
  },
  photo: {
    hash: "photo",

    /* ---------- Category UI ---------- */
    addCategoryBtn: "#photo-add",
    categoryForm: "#photo-cat-form",
    categoryName: "#Name",
    searchInput: "#photo-cat-search-input, #photo-search-input",
    searchBtn: "#photo-cat-search-btn, #photo-search-btn",

    accessGroup: "#isPublic",
    publicLabel: "#Public",

    saveCategory: "#btnSave",
    saveAndAddPhotos: "#btnSaveAddPhotos",

    /* ---------- Album list ---------- */
    addItemBtn: "#btnAddAlbum",

    /* ---------- Album editor ---------- */
    albumTitle: "#tb-photo-title",
    fileInput: "input.file-upload-input",

    previewTable: "#photo_table",
    previewRow: "tr.photo-item-row",
    previewImage: "img.photo-preview",
    previewKeyAttr: "tfn",

    /* ---------- Photo metadata ---------- */
    photoTitleInput: ".photo-title-box",
    photoCaptionInput: ".photo-caption-box",
    photoTagsInput: ".photo-tags-box",

    saveItem: "#btnSavePhoto",
    saveAndAddItem: "#btnSaveAddPhoto"
  },

  news: {
    hash: "news",

    // Category UI
    addCategoryBtn: "#news-add",
    categoryForm: "#news-cat-form",
    categoryName: "#Name",
    accessGroup: "#isPublic",
    publicLabel: "#Public",
    searchInput: "#news-cat-search-input, #news-search-input",
    searchBtn: "#news-cat-search-btn, #news-search-btn",
    saveCategory: "#btnSave",
    saveAndAddItem: "#btnSaveAddNews",

    // Item UI
    addItemBtn: "#btnAddNews",
    itemTitle: "#txtHeadline",
    itemAuthor: "#txtAuthor",
    itemSummaryIframe: "#fldBriefDescription_ifr",
    itemBodyIframe: "#fldDescription_ifr",
    imageDropZone: "#fileupload",
    imageInput: "input.file-upload-input",
    photoTable: "#photo_table",
    photoCaptionInput: ".photo-caption-box",
    itemDate: "#default_pub_date",
    applyItemDateBtn: "#default-dates",
    itemCancelBtn: "#btnCancelNews",
    saveItem: "#btnSave",
    saveAndAddAnotherItem: "#btnSaveAd"
  },

  event: {
    hash: "event",

    // Category UI
    addCategoryBtn: "#event-add",
    categoryForm: "#event-cat-form",
    categoryName: "#Name",
    accessGroup: "#isPublic",
    publicLabel: "#Public",
    searchInput: "#event-cat-search-input, #event-search-input",
    searchBtn: "#event-cat-search-btn, #event-search-btn",
    showBriefToggle: "#BriefDescriptionInd",
    showLongToggle: "#LongDescriptionInd",
    enableIcalToggle: "#ICalInd",
    saveCategory: "#btnSave",
    saveAndAddItem: "#btnSaveAddEvents",
    addItemBtn: "#btnAddEvent",

    // Event UI
    singleEventRadio: "#rdoSingleEvent",
    recurringEventRadio: "#rdoRecurring",
    itemTitle: "#tb-event-title",
    startDate: "#startDate",
    startTime: "#startTime",
    endDate: "#endDate",
    endTime: "#endTime",
    recurStart: "#recurStart",
    recurEnd: "#recurEnd",
    detailsIframe: "#fldDescription_ifr",
    longDetailsIframe: "#fldLongDescription_ifr",
    newLocationRadio: "#rdoNewLocation",
    newLocation: "#txtNewLocation",
    contactName: "#txtContactName",
    contactEmail: "#txtContactEmail",
    registrationSelect: "#ddlb_registrations",
    saveItem: "#btnSaveEvent",
    saveAndAddItemEvent: "#btnSaveAddEvent",
    cancelItem: "#btnCancelEvent"
  }


};