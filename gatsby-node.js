const { google } = require('googleapis');
const fs = require(`fs`);
const lodash = require('lodash')

const log = str => console.log(`\n🚗 `, str);
const FOLDER = `application/vnd.google-apps.folder`;

const getFolder = async (gDriveClient, folderId) => {
    const { data: { files }} = await gDriveClient.files.list({ q: `'${folderId}' in parents`});
    return files;
};

const getAuthorziedGdriveClient = (options) => {
  let key;
  const { scopes } = options;

  if (options.key) key = JSON.parse(options.key);
  if (fs.existsSync(options.pemFilePath)) {
      key = require(options.pemFilePath);
  }
    // setting the general auth property for client
    const token = new google.auth.JWT(
      key.client_email,
      null,
      key.private_key,
      scopes
  );
  google.options({ auth: token });

  return google.drive('v3');
};

function fetchFilesInFolder(filesInFolder, gDriveClient) {
    const promises = [];

    filesInFolder.forEach(async (file) => {
      if (file.mimeType === FOLDER) {
        // Then, get the files inside and run the function again.
        const nestedFiles = getFolder(gDriveClient, file.id)
          .then((files) => {
            // combining array of promises into one.
            return Promise.all(fetchFilesInFolder(files, gDriveClient));
          });
        promises.push(nestedFiles);
      }
      else {
        promises.push(
          new Promise(async (resolve, reject) => {
            const { data } = await gDriveClient.files.get({ fileId: file.id, fields: "description, name, kind, modifiedTime, trashed, id" });
            resolve(data);
        }));
      }
    });

    return promises;
};

exports.sourceNodes = async ({ actions }, options) => {
    log('creating graphql nodes...', options);
    const { createNode } = actions;
    const { folderId } = options;
    const gDriveClient = getAuthorziedGdriveClient(options);
    let filesInFolder;

    try {
      filesInFolder = await getFolder(gDriveClient, folderId);
    }
    catch(e) {
      console.log(`some stupid error... ${e}`);
    }
  
    Promise.all(fetchFilesInFolder(filesInFolder, gDriveClient))
      .then((allFiles) => {
        lodash.flattenDeep(allFiles)
            .filter((file) => !file.trashed)
            .map((file) => ({
                id: file.id,
                description: file.description ? file.description : '',
                name: file.name,
                internal: {
                    contentDigest: `${file.id}_${file.modifiedTime}`,
                    type: 'gDriveContent'
                }
            }))
            .forEach((file) => createNode(file))
      })
      .catch(e => console.log(`Error: ${e}`));

      // we're done, return.
      return;
};