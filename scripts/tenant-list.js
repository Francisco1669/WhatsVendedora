const { initializeDatabase, closeDatabase, listTenants } = require("../src/db/database");

async function run() {
    await initializeDatabase();
    const tenants = await listTenants();
    console.log(
        JSON.stringify(
            {
                total: tenants.length,
                data: tenants.map((tenant) => ({
                    id: tenant.id,
                    slug: tenant.slug,
                    name: tenant.name,
                    active: tenant.active,
                    createdAt: tenant.createdAt,
                })),
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
