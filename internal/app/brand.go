package app

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
	_ "time/tzdata" // Containeren har ikkje tidssoner. Jula skal byrje ved midnatt i Noreg.

	"github.com/pocketbase/pocketbase/core"
)

// Ikona på heimskjermen og i varsel følgjer sesongen. Grøn flate og hjarte i jula,
// lilla flate og stjerne resten av året. Appen sjølv byter på klienten, der brukaren kan overstyre.
var seasonAssets = []string{"favicon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "manifest.webmanifest"}

var oslo = func() *time.Location {
	if loc, err := time.LoadLocation("Europe/Oslo"); err == nil {
		return loc
	}
	return time.UTC
}()

// isJulDate er sann frå 1. november til og med 26. desember, same reglar som isFest i nettlesaren.
func isJulDate(t time.Time) bool {
	t = t.In(oslo)
	return t.Month() == time.November || (t.Month() == time.December && t.Day() <= 26)
}

// festName gjev namnet på varianten for resten av året, til dømes icon-192-fest.png.
func festName(name string) string {
	ext := path.Ext(name)
	return strings.TrimSuffix(name, ext) + "-fest" + ext
}

func (s *server) seasonAsset(name string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if s.cfg.Assets == nil {
			return e.NotFoundError("", nil)
		}
		fest := !isJulDate(s.now())
		var data []byte
		var err error
		if name == "manifest.webmanifest" {
			data, err = fs.ReadFile(s.cfg.Assets, name)
			if err == nil && fest {
				data = []byte(strings.ReplaceAll(string(data), "#17372f", "#2f2b5a"))
			}
		} else {
			file := name
			if fest {
				file = festName(name)
			}
			data, err = fs.ReadFile(s.cfg.Assets, file)
		}
		if err != nil {
			return e.NotFoundError("", nil)
		}
		kind := mime.TypeByExtension(path.Ext(name))
		if name == "manifest.webmanifest" {
			kind = "application/manifest+json"
		}
		// Kort levetid, så heimskjermen hentar rett ikon når sesongen skiftar.
		e.Response.Header().Set("Cache-Control", "public, max-age=3600")
		return e.Blob(http.StatusOK, kind, data)
	}
}
