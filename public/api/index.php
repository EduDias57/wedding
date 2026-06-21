<?php

/**
 * API nativa de alta compatibilidade para o Convite de Casamento (Postgres/Neon)
 * Contorna bugs de rotas do framework Kamu na Vercel
 */

// 1. Liberação de segurança (CORS) para o seu site conseguir conversar com a API
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Credentials: true");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, X-Token");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// 2. Conexão com o Banco de Dados Neon
$host = 'ep-round-violet-ac12j9h3-pooler.sa-east-1.aws.neon.tech';
$db   = 'neondb';
$user = 'neondb_owner';
$pass = 'npg_Q5uUN3hteavP';

try {
    $pdo = new PDO("pgsql:host=$host;dbname=$db;sslmode=require", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
    ]);
} catch (\PDOException $e) {
    header('Content-Type: application/json', true, 500);
    echo json_encode(["error" => "Falha no banco"]);
    exit;
}

// Obtém o caminho da requisição do site
$requestUri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// 3. Rota de Inicialização / Configuração do site
if (preg_match('#^/api/v2/config$#', $requestUri)) {
    header('Content-Type: application/json');
    echo json_encode([
        "status" => true,
        "code" => 200,
        "data" => [
            "user" => ["username" => "admin"],
            "config" => ["title" => "Casamento"]
        ]
    ]);
    exit;
}

//*********************************meu comentario
// 4. Rota para Listar as Mensagens no Mural
//if (preg_match('#^/api/v2/comment$#', $requestUri) && $_SERVER['REQUEST_METHOD'] === 'GET') {
//    header('Content-Type: application/json');
//    try {
//        $stmt = $pdo->query("SELECT uuid, name, presence, comment, created_at FROM comments ORDER BY id DESC");
//        $comments = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Formata os dados de saída idênticos ao padrão do JavaScript do convite
//        echo json_encode([
//            "status" => true,
//            "code" => 200,
//            "data" => [
//                "data" => $comments,
//                "total" => count($comments)
//            ]
//        ]);
//    } catch (Exception $e) {
//        echo json_encode(["status" => false, "data" => ["data" => [], "total" => 0]]);
//    }
//    exit;
//}
//**********************meu comentario

//*************************sujestao da IA

// 4. Rota para Listar as Mensagens no Mural (Com Cache para evitar Rate Limit)
if (preg_match('#^/api/v2/comment$#', $requestUri) && $_SERVER['REQUEST_METHOD'] === 'GET') {
    // Diz para a Vercel guardar esse resultado na memória por 5 minutos (300 segundos)
    header('Cache-Control: s-maxage=300, stale-while-revalidate=60');
    header('Content-Type: application/json');
    try {
        $stmt = $pdo->query("SELECT uuid, name, presence, comment, created_at FROM comments ORDER BY id DESC");
        $comments = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode([
            "status" => true,
            "code" => 200,
            "data" => [
                "data" => $comments,
                "total" => count($comments)
            ]
        ]);
    } catch (Exception $e) {
        echo json_encode(["status" => false, "data" => ["data" => [], "total" => 0]]);
    }
    exit;
}


//*************************sujestao da IA

// 5. Rota para Receber e Salvar uma Nova Mensagem
if (preg_match('#^/api/v2/comment$#', $requestUri) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    
    // Lê os dados JSON enviados pelo formulário do convite
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!empty($input['name']) && !empty($input['comment'])) {
        try {
            $uuid = bin2hex(random_bytes(16)); // Gera identificador único para o comentário
            $presence = isset($input['presence']) ? $input['presence'] : '0';
            
            $stmt = $pdo->prepare("INSERT INTO comments (uuid, name, presence, comment) VALUES (?, ?, ?, ?)");
            $stmt->execute([$uuid, $input['name'], (string)$presence, $input['comment']]);
            
            echo json_encode([
                "status" => true,
                "code" => 201,
                "data" => [
                    "uuid" => $uuid,
                    "name" => $input['name'],
                    "presence" => $presence,
                    "comment" => $input['comment'],
                    "created_at" => date('Y-m-data H:i:s')
                ]
            ]);
        } catch (Exception $e) {
            echo json_encode(["status" => false, "error" => "Erro ao salvar"]);
        }
    } else {
        echo json_encode(["status" => false, "error" => "Dados invalidos"]);
    }
    exit;
}

// Rota de segurança / fallback
header('Content-Type: application/json');
echo json_encode(["status" => true, "message" => "Servidor Ativo"]);
exit;
