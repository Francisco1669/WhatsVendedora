const bcrypt = require("bcryptjs");
const env = require("../config/env");

function getSaltRounds() {
    return Math.max(8, Number(env.AUTH_BCRYPT_ROUNDS || 10));
}

function hashPassword(plainPassword) {
    return bcrypt.hashSync(plainPassword, getSaltRounds());
}

function comparePassword(plainPassword, passwordHash) {
    return bcrypt.compareSync(plainPassword, passwordHash);
}

module.exports = {
    hashPassword,
    comparePassword,
};
