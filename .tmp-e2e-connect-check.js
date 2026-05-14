const axios = require("axios");

async function main() {
    const base = "http://127.0.0.1:3333";
    const email = "admin@seudominio.com.br";
    const password = "SENHA_REAL_DO_ADMIN";

    const login = await axios.post(`${base}/auth/login`, { email, password });
    const token = login.data?.accessToken;
    if (!token) {
        throw new Error("Sem token de acesso no login.");
    }

    const id = `anapaula_${Math.floor(Math.random() * 900 + 100)}`;
    const createBody = {
        id,
        label: "Ana Paula",
        phoneNumber: "5555991631511",
        evolutionInstance: `evo_${id}`,
        active: true,
    };

    const create = await axios.post(`${base}/api/instances?provision=true`, createBody, {
        headers: { Authorization: `Bearer ${token}` },
    });

    await new Promise((resolve) => setTimeout(resolve, 3500));

    const connect = await axios.post(
        `${base}/api/instances/${encodeURIComponent(id)}/connect`,
        {},
        {
            headers: { Authorization: `Bearer ${token}` },
        }
    );

    console.log(`INSTANCE_ID=${id}`);
    console.log(`CREATE=${JSON.stringify(create.data)}`);
    console.log(`CONNECT=${JSON.stringify(connect.data)}`);
}

main().catch((error) => {
    console.error("E2E_ERROR", error.response?.status || "network", error.response?.data || error.message);
    process.exit(1);
});
