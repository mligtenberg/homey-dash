using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDisplayTimerSound : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TimerSound",
                table: "Displays",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TimerSound",
                table: "Displays");
        }
    }
}
