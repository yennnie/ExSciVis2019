file(GLOB_RECURSE FRAMEWORK_SHADER_VERTEX RELATIVE ${CMAKE_CURRENT_SOURCE_DIR} *.vert)
file(GLOB_RECURSE FRAMEWORK_SHADER_FRAGME RELATIVE ${CMAKE_CURRENT_SOURCE_DIR} *.frag)

add_executable(MyVolumeRaycaster my_volume_raycaster.cpp
              ${FRAMEWORK_SHADER_VERTEX}
              ${FRAMEWORK_SHADER_FRAGME})
#add_test(buffer-uniform COMMAND $<TARGET_FILE:MyVolumeRaycaster>)

target_link_libraries(MyVolumeRaycaster ${FRAMEWORK_NAME} ${BINARY_FILES})
add_dependencies(MyVolumeRaycaster glfw ${FRAMEWORK_NAME} ${COPY_BINARY})

install(TARGETS MyVolumeRaycaster DESTINATION .)
