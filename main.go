package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/pocketbase/pocketbase"

	"pakkelapp/internal/app"
)

//go:embed all:web/dist
var webDist embed.FS

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func main() {
	addr := env("JUL_ADDR", "0.0.0.0:8080")

	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 4 * time.Second}
		port := addr[strings.LastIndex(addr, ":")+1:]
		res, err := client.Get("http://127.0.0.1:" + port + "/api/health")
		if err != nil || res.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}

	assets, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		log.Fatal(err)
	}

	pb := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:  env("JUL_DATA_DIR", "./pb_data"),
		HideStartBanner: true,
	})

	app.Register(pb, app.Config{
		PublicURL:   strings.TrimRight(os.Getenv("JUL_PUBLIC_URL"), "/"),
		InviteCode:  strings.TrimSpace(os.Getenv("JUL_INVITE_CODE")),
		EnableAdmin: os.Getenv("JUL_ENABLE_ADMIN") == "true",
		AIModel:     env("OPENAI_MODEL", "gpt-6.1-sol"),
		AIKey:       strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		AIBaseURL:   strings.TrimSpace(os.Getenv("JUL_AI_BASE_URL")),
		TestNow:     strings.TrimSpace(os.Getenv("JUL_TEST_NOW")),
		Assets:      assets,
	})

	// PocketBase les argument frå os.Args, så vi set serve-kommandoen her.
	args := []string{os.Args[0], "serve", "--http=" + addr}
	if origin := strings.TrimRight(os.Getenv("JUL_PUBLIC_URL"), "/"); origin != "" {
		args = append(args, "--origins="+origin)
	}
	os.Args = args
	if err := pb.Start(); err != nil {
		log.Fatal(err)
	}
}
