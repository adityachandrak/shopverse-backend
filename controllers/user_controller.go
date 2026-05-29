package controllers

import (
	"shopverse-backend/config"
	"shopverse-backend/models"

	"github.com/gofiber/fiber/v2"
)

func Register(c *fiber.Ctx) error {

	var user models.User

	if err := c.BodyParser(&user); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Cannot parse JSON",
		})
	}

	config.DB.Create(&user)

	return c.JSON(fiber.Map{
		"message": "User registered successfully",
		"user":    user,
	})
}
 
func LoginUser(c *fiber.Ctx) error {
	type LoginInput struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var input LoginInput
	var user models.User

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid input",
		})
	}

	config.DB.Where("email = ?", input.Email).First(&user)

	if user.ID == 0 {
		return c.Status(401).JSON(fiber.Map{
			"message": "User not found",
		})
	}

	if user.Password != input.Password {
		return c.Status(401).JSON(fiber.Map{
			"message": "Wrong password",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Login successful",
		"user":    user,
	})
}