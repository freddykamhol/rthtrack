<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function reply(int $status, array $body): void { http_response_code($status); echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); exit; }
function storage(): string {
    $dir = getenv('RTHTRACK_DATA_DIR') ?: dirname(__DIR__) . '/rthtrack-data';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) reply(503, ['error'=>'Server-Speicher nicht beschreibbar']);
    return $dir;
}
function upstream(string $url): ?array {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>5, CURLOPT_TIMEOUT=>12, CURLOPT_USERAGENT=>'RTHtrack/1.0', CURLOPT_HTTPHEADER=>['Accept: application/json']]);
    $body = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($status !== 200 || !is_string($body)) return null;
    $data = json_decode($body, true);
    return is_array($data) && isset($data['ac']) && is_array($data['ac']) ? $data : null;
}
try {
    $action = $_GET['action'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'];
    if ($action === 'health') reply(200, ['ok'=>true, 'storage'=>is_writable(storage()), 'curl'=>function_exists('curl_init')]);
    if ($action === 'flights' && $method === 'GET') {
        $file = fopen(storage() . '/flights.json', 'c+');
        if (!$file || !flock($file, LOCK_EX)) reply(503, ['error'=>'Live-Speicher nicht verfügbar']);
        $cache = json_decode(stream_get_contents($file), true);
        if (is_array($cache) && time() - ($cache['fetchedAt'] ?? 0) < 25) { flock($file, LOCK_UN); fclose($file); reply(200, $cache); }
        $north = upstream('https://opendata.adsb.fi/api/v3/lat/53/lon/10/dist/250');
        usleep(1100000);
        $south = upstream('https://opendata.adsb.fi/api/v3/lat/49/lon/10/dist/250');
        $unique = [];
        foreach ([$north, $south] as $part) foreach ($part['ac'] ?? [] as $ac) {
            if (isset($ac['hex'], $ac['lat'], $ac['lon']) && ($ac['seen_pos'] ?? 9999) <= 120) $unique[$ac['hex']] = $ac;
        }
        if (!$north && !$south) { flock($file, LOCK_UN); fclose($file); reply(502, ['error'=>'ADSB.fi aktuell nicht erreichbar']); }
        $result = ['ac'=>array_values($unique), 'fetchedAt'=>time(), 'partial'=>!$north || !$south, 'source'=>'adsb.fi'];
        rewind($file); ftruncate($file, 0); fwrite($file, json_encode($result, JSON_THROW_ON_ERROR)); fflush($file); flock($file, LOCK_UN); fclose($file); reply(200, $result);
    }
    if ($action !== 'settings') reply(404, ['error'=>'Unbekannter Endpunkt']);
    $token = $_SERVER['HTTP_X_RTHTRACK_PROFILE'] ?? '';
    if (!preg_match('/^[a-f0-9]{64}$/D', $token)) reply(401, ['error'=>'Profil-Link fehlt']);
    if (!in_array($method, ['GET','PUT'], true)) reply(405, ['error'=>'Methode nicht erlaubt']);
    $file = fopen(storage() . '/profile-' . hash('sha256', $token) . '.json', 'c+');
    if (!$file || !flock($file, LOCK_EX)) reply(503, ['error'=>'Profil-Speicher nicht verfügbar']);
    $current = json_decode(stream_get_contents($file), true) ?: ['revision'=>0, 'settings'=>null];
    if ($method === 'GET') { flock($file, LOCK_UN); fclose($file); reply(200, $current); }
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') reply(403, ['error'=>'Fremder Ursprung']);
    $raw = file_get_contents('php://input', false, null, 0, 262145);
    if (strlen($raw) > 262144) reply(413, ['error'=>'Zu viele Daten']);
    $input = json_decode($raw, true);
    if (!is_array($input) || ($input['revision'] ?? -1) !== $current['revision']) reply(409, ['error'=>'Profil wurde auf einem anderen Gerät geändert. Bitte neu laden.']);
    $s = $input['settings'] ?? null;
    if (!is_array($s) || !isset($s['districts'], $s['pads']) || !is_array($s['districts']) || count($s['districts']) > 20 || !is_array($s['pads']) || count($s['pads']) > 500) reply(422, ['error'=>'Ungültige Einstellungen']);
    foreach ($s['districts'] as $d) if (!is_string($d) || strlen($d) > 160) reply(422, ['error'=>'Ungültiger Landkreis']);
    foreach (['showFlights','showPads','showOtherHelis','notificationsEnabled'] as $key) if (!isset($s[$key]) || !is_bool($s[$key])) reply(422, ['error'=>'Ungültige Option']);
    foreach ($s['pads'] as $p) {
        if (!is_array($p) || !is_string($p['id'] ?? null) || !is_string($p['name'] ?? null) || !strlen(trim($p['name'])) || strlen($p['name']) > 160 || !is_string($p['notes'] ?? null) || strlen($p['notes']) > 5000 || !is_bool($p['active'] ?? null) || !in_array($p['category'] ?? '', ['Wiese','Landeplatz beleuchtet','Krankenhaus','Feuerwehr','Sportplatz','Sonstige'], true)) reply(422, ['error'=>'Ungültiger Landeplatz']);
        $c = $p['coords'] ?? null;
        if (!is_array($c) || count($c) !== 2 || !is_numeric($c[0]) || !is_numeric($c[1]) || abs((float)$c[0]) > 90 || abs((float)$c[1]) > 180) reply(422, ['error'=>'Ungültige Koordinaten']);
    }
    $next = ['revision'=>$current['revision'] + 1, 'settings'=>$s];
    rewind($file); ftruncate($file, 0);
    if (fwrite($file, json_encode($next, JSON_THROW_ON_ERROR)) === false) reply(503, ['error'=>'Speichern fehlgeschlagen']);
    fflush($file); flock($file, LOCK_UN); fclose($file); reply(200, $next);
} catch (Throwable $e) { error_log('RTHtrack: ' . $e->getMessage()); reply(503, ['error'=>'Server-Dienst momentan nicht verfügbar']); }
