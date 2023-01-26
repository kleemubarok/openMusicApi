require('dotenv').config();

const Hapi = require('@hapi/hapi');
const Jwt = require('@hapi/jwt');
const config = require('./utils/config');
// const path = require('path');

const ClientError = require('./exceptions/ClientError');
// Albums services
const albums = require('./api/albums');
const AlbumsService = require('./services/postgres/AlbumsService');
const AlbumsValidator = require('./validator/albums');
// Songs services
const songs = require('./api/songs');
const SongsService = require('./services/postgres/SongsService');
const SongsValidator = require('./validator/songs');
// Users services
const users = require('./api/users');
const UsersService = require('./services/postgres/UsersService');
const UsersValidator = require('./validator/users');
// authentications
const authentications = require('./api/authentications');
const AuthenticationsService = require('./services/postgres/AuthenticationsService');
const TokenManager = require('./tokenize/TokenManager');
const AuthenticationsValidator = require('./validator/authentications');
// playlists
const playlists = require('./api/playlists');
const PlaylistsService = require('./services/postgres/PlaylistsService');
const PlaylistsValidator = require('./validator/playlist');
// collaborations
const collaborations = require('./api/collaborations');
const CollaborationsService = require('./services/postgres/CollaborationsService');
const CollaborationsValidator = require('./validator/collaborations');
// Exports
// eslint-disable-next-line no-underscore-dangle
const _exports = require('./api/exports');
const ProducerService = require('./services/rabbitmq/ProducerService');
const ExportsValidator = require('./validator/exports');
// uploads
// const uploads = require('./api/uploads');
const StorageService = require('./services/S3/StorageService');
const UploadsValidator = require('./validator/uploads');
// cache
const CacheService = require('./services/redis/CacheService');

const init = async () => {
  const cacheService = new CacheService();
  const albumsService = new AlbumsService(cacheService);
  const songsService = new SongsService();
  const usersService = new UsersService();
  // eslint-disable-next-line max-len
  // const storageService = new StorageService(path.resolve(__dirname, 'api/uploads/file/images')); // local
  const storageService = new StorageService();
  const authenticationsService = new AuthenticationsService();
  const collaborationsService = new CollaborationsService(usersService);
  const playlistsService = new PlaylistsService(collaborationsService);
  const server = Hapi.server({
    port: config.app.port,
    host: config.app.host,
    routes: {
      cors: {
        origin: ['*'],
      },
    },
  });

  // registrasi plugin eksternal
  await server.register([
    {
      plugin: Jwt,
    },
  ]);

  // mendefinisikan strategy autentikasi jwt
  server.auth.strategy('openmusicapi_jwt', 'jwt', {
    keys: process.env.ACCESS_TOKEN_KEY,
    verify: {
      aud: false,
      iss: false,
      sub: false,
      maxAgeSec: process.env.ACCESS_TOKEN_AGE,
    },
    validate: (artifacts) => ({
      isValid: true,
      credentials: {
        id: artifacts.decoded.payload.id,
      },
    }),
  });

  await server.register([
    {
      plugin: albums,
      options: {
        service: albumsService,
        storageService,
        UploadsValidator,
        validator: AlbumsValidator,
      },
    }, {
      plugin: songs,
      options: {
        service: songsService,
        validator: SongsValidator,
      },
    }, {
      plugin: users,
      options: {
        service: usersService,
        validator: UsersValidator,
      },
    }, {
      plugin: authentications,
      options: {
        authenticationsService,
        usersService,
        tokenManager: TokenManager,
        validator: AuthenticationsValidator,
      },
    }, {
      plugin: playlists,
      options: {
        service: playlistsService,
        validator: PlaylistsValidator,
      },
    }, {
      plugin: collaborations,
      options: {
        collaborationsService,
        playlistsService,
        validator: CollaborationsValidator,
      },
    }, {
      plugin: _exports,
      options: {
        service: ProducerService,
        playlistsService,
        validator: ExportsValidator,
      },
    },
  ]);

  server.ext('onPreResponse', (request, h) => {
  // mendapatkan konteks response dari request
    const { response } = request;
    if (response instanceof Error) {
      // penanganan client error secara internal.
      if (response instanceof ClientError) {
        const newResponse = h.response({
          status: 'fail',
          message: response.message,
        });
        newResponse.code(response.statusCode);
        return newResponse;
      }
      // mempertahankan penanganan client error oleh hapi secara native, seperti 404, etc.
      if (!response.isServer) {
        return h.continue;
      }
      // penanganan server error sesuai kebutuhan
      const newResponse = h.response({
        status: 'fail',
        message: 'terjadi kegagalan pada server kami',
      });
      newResponse.code(500);
      console.log(`err msg: ${response.message}`);
      return newResponse;
    }
    // jika bukan error, lanjutkan dengan response sebelumnya (tanpa terintervensi)
    return h.continue;
  });

  await server.start();
  console.log('Server running on %s', server.info.uri);
};

init();
