package app

import (
	"io"
	"log"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// personDetails er det som berre personen sjølv kan skrive på personen. Det andre veit, ligg i
// person_notes (tekst) og photos (bilete), der berre den som skreiv det ser det.
var personDetails = []string{"relation", "birth_year", "gender", "age_group", "interests", "sizes", "budget", "avatar"}

var noteFields = []string{"relation", "birth_year", "gender", "age_group", "interests", "sizes"}

// detailsOwner er den som har skrive detaljane på personen. Har personen laga seg sjølv, er dei hans eigne.
func detailsOwner(person *core.Record) (owner string, self bool) {
	user, creator := person.GetString("user"), person.GetString("created_by")
	return creator, user != "" && user == creator
}

func hasDetails(person *core.Record) bool {
	for _, f := range personDetails {
		switch v := person.Get(f).(type) {
		case string:
			if v != "" {
				return true
			}
		case float64:
			if v != 0 {
				return true
			}
		case int:
			if v != 0 {
				return true
			}
		}
	}
	return false
}

// movePrivateDetails flyttar det nokon har skrive om ein annan, frå den delte personen til eit
// privat notat og eit privat bilete for den som skreiv det. Køyrer ved kvar oppstart og gjer
// ingenting når alt alt er flytta.
func movePrivateDetails(app core.App) error {
	people, err := app.FindAllRecords("people")
	if err != nil {
		return err
	}
	notes, err := app.FindCollectionByNameOrId("person_notes")
	if err != nil {
		return err
	}
	photos, err := app.FindCollectionByNameOrId("photos")
	if err != nil {
		return err
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()

	moved := 0
	for _, person := range people {
		owner, self := detailsOwner(person)
		if self || !hasDetails(person) {
			continue
		}
		if owner != "" {
			note, err := app.FindFirstRecordByFilter("person_notes", "user = {:u} && person = {:p}", dbx.Params{"u": owner, "p": person.Id})
			if err != nil {
				note = core.NewRecord(notes)
				note.Set("user", owner)
				note.Set("person", person.Id)
			}
			for _, f := range noteFields {
				if note.GetString(f) == "" || note.GetString(f) == "0" {
					note.Set(f, person.Get(f))
				}
			}
			if err := app.Save(note); err != nil {
				return err
			}
			if avatar := person.GetString("avatar"); avatar != "" {
				if _, err := app.FindFirstRecordByFilter("photos", "user = {:u} && person = {:p}", dbx.Params{"u": owner, "p": person.Id}); err != nil {
					if err := copyAvatar(app, fsys, photos, person, owner, avatar); err != nil {
						log.Printf("kunne ikkje flytte bilete av %s: %v", person.Id, err)
					}
				}
			}
		}
		for _, f := range personDetails {
			person.Set(f, nil)
		}
		if err := app.SaveNoValidate(person); err != nil {
			return err
		}
		moved++
	}
	if moved > 0 {
		log.Printf("Gjorde detaljar om %d personar private for den som skreiv dei.", moved)
	}
	return nil
}

func copyAvatar(app core.App, fsys *filesystem.System, photos *core.Collection, person *core.Record, owner, avatar string) error {
	r, err := fsys.GetReader(person.BaseFilesPath() + "/" + avatar)
	if err != nil {
		return err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, 8<<20))
	if err != nil {
		return err
	}
	file, err := filesystem.NewFileFromBytes(data, avatar)
	if err != nil {
		return err
	}
	photo := core.NewRecord(photos)
	photo.Set("user", owner)
	photo.Set("person", person.Id)
	photo.Set("image", file)
	return app.Save(photo)
}
