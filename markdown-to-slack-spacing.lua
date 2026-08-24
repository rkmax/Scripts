-- Slack's composer (Quill) renders adjacent HTML blocks as consecutive
-- lines, so the blank line the Markdown source had before a section
-- title is lost on paste. Quill only keeps a blank line when it is an
-- explicit paragraph containing <br>, so insert one before each title.

local BLANK_LINE = pandoc.RawBlock('html', '<p><br /></p>')

local function is_section_title(block)
  if block.t == 'Header' then
    return true
  end
  return block.t == 'Para'
    and #block.content == 1
    and block.content[1].t == 'Strong'
end

function Pandoc(doc)
  local spaced = pandoc.List()
  for index, block in ipairs(doc.blocks) do
    if index > 1 and is_section_title(block) then
      spaced:insert(BLANK_LINE)
    end
    spaced:insert(block)
  end
  doc.blocks = spaced
  return doc
end
