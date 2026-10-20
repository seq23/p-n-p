'use strict';
/**
 * The placeholder drawings (balloons on sticks over a beige box; a cartoon door with pumpkins)
 * that stood in for photos until 20 Oct 2026, by SHA-256 of the file, and the real photo each old
 * path now points to. validate:no-placeholder-images fails if any published page, email or source
 * references one of these paths, or if any image under assets/ has one of these hashes (so a
 * drawing re-added under a new name is caught too).
 */
const PLACEHOLDERS = Object.freeze({
  'assets/img/party/bartlett-birthday-party-decor-setup.jpg': { sha1: 'd611967bc62e48e189a868b22e79b0491316f352', photo: 'assets/img/celebrations/birthday-entry-celebration.jpg' },
  'assets/img/party/germantown-party-decor-bridal-shower-setup.jpg': { sha1: 'd501358678a1f420d0c4251691f59f17ee3b808d', photo: 'assets/img/celebrations/birthday-entry-celebration.jpg' },
  'assets/img/party/memphis-party-decor-hotel-room-birthday-setup.jpg': { sha1: 'fd2da9494d2a1b8ca667c98c4d7ef3ac9332bace', photo: 'assets/img/celebrations/romantic-bedroom-experience.jpg' },
  'assets/img/party/east-memphis-hotel-room-celebration-decor.jpg': { sha1: '0b076fcf714e1238fe6b1cf91750c03db6a15773', photo: 'assets/img/celebrations/romantic-bedroom-experience.jpg' },
  'assets/img/party/collierville-grazing-table-party-decor.jpg': { sha1: 'fff41db3984738d54d6cbbb7cb9b38239f371b06', photo: 'assets/img/grazing/grazing-table-corporate.jpg' },
  'assets/img/party/lakeland-small-party-grazing-table-setup.jpg': { sha1: 'de1e816bd4447f3b3fcf5e1b0a6f951ca2ca6e53', photo: 'assets/img/grazing/grazing-table-corporate.jpg' },
  'assets/img/porch/arlington-front-porch-styling-pumpkins.jpg': { sha1: '27c92a12ef45d09dd09b279a056ac7212160e490', photo: 'assets/img/porch/seasonal-exterior-fall.jpg' },
  'assets/img/porch/east-memphis-luxury-porch-installation.jpg': { sha1: 'f7857785ee1db20a55cd935a55a70f1cb0531058', photo: 'assets/img/porch/memphis-fall-front-porch-decorating-germantown.jpg' },
  'assets/img/porch/lakeland-holiday-porch-decorating-entry.jpg': { sha1: '56da46ac8203710716b7296edb7b2328d146e7c3', photo: 'assets/img/porch/collierville-christmas-porch-decorating-front-door.jpg' },
});
module.exports = { PLACEHOLDERS };
