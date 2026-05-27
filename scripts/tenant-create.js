const {
    initializeDatabase,
    closeDatabase,
    upsertTenant,
    getTenantBySlug,
    getAdminUserByEmail,
    createAdminUser,
} = require("../src/db/database");
const { hashPassword } = require("../src/services/password-service");

function getArgValue(flag) {
    const args = process.argv.slice(2);
    const index = args.indexOf(flag);
    if (index === -1) {
        return "";
    }
    return String(args[index + 1] || "").trim();
}

function assertRequired(value, label) {
    if (!String(value || "").trim()) {
        throw new Error(`Parametro obrigatorio ausente: ${label}`);
    }
}

function normalizeSlug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function run() {
    const slug = normalizeSlug(getArgValue("--slug"));
    const name = getArgValue("--name");
    const ownerName = getArgValue("--owner-name");
    const ownerEmail = getArgValue("--owner-email").toLowerCase();
    const ownerPassword = getArgValue("--owner-password");

    assertRequired(slug, "--slug");
    assertRequired(name, "--name");
    assertRequired(ownerName, "--owner-name");
    assertRequired(ownerEmail, "--owner-email");
    assertRequired(ownerPassword, "--owner-password");

    await initializeDatabase();

    const tenant = await upsertTenant({
        id: slug.replace(/-/g, "_"),
        slug,
        name,
        active: true,
    });

    const existingOwner = await getAdminUserByEmail(ownerEmail, tenant.id);
    let ownerStatus = "already_exists";
    let ownerUser = existingOwner;

    if (!existingOwner) {
        ownerUser = await createAdminUser({
            tenantId: tenant.id,
            name: ownerName,
            email: ownerEmail,
            passwordHash: hashPassword(ownerPassword),
            role: "owner",
            active: true,
        });
        ownerStatus = "created";
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                tenant: {
                    id: tenant.id,
                    slug: tenant.slug,
                    name: tenant.name,
                    active: tenant.active,
                },
                owner: {
                    status: ownerStatus,
                    id: ownerUser?.id || null,
                    email: ownerUser?.email || ownerEmail,
                },
            },
            null,
            2
        )
    );
}

run()
    .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDatabase();
    });
