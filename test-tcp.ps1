try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('127.0.0.1', 2345)
    Write-Host 'Connected OK'
    $tcp.Close()
    exit 0
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    exit 1
}
